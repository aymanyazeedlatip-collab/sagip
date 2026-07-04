import math
import time
import requests
import numpy as np


OPENTOPO_URL = "https://api.opentopodata.org/v1/srtm30m"


def generate_grid_points(north: float, south: float, east: float, west: float, resolution: int):
    """
    Creates a square grid of latitude/longitude points inside the selected rectangle.
    Example:
    resolution = 40 means 40 x 40 = 1600 points.
    """

    latitudes = np.linspace(north, south, resolution)
    longitudes = np.linspace(west, east, resolution)

    points = []

    for row_index, lat in enumerate(latitudes):
        for col_index, lng in enumerate(longitudes):
            points.append({
                "row": row_index,
                "col": col_index,
                "lat": float(lat),
                "lng": float(lng),
            })

    return points, latitudes.tolist(), longitudes.tolist()


def synthetic_elevation(lat: float, lng: float):
    """
    Backup terrain generator.
    This is used only when the real elevation API fails.

    It creates coordinate-based fake terrain so the demo can still run.
    This is NOT real DEM data.
    """

    base = 40

    wave_1 = math.sin(lat * 8.1) * 22
    wave_2 = math.cos(lng * 7.7) * 18
    wave_3 = math.sin((lat + lng) * 12.4) * 10

    ridge = 0
    if math.sin(lat * 3.5 + lng * 2.2) > 0.65:
        ridge = 35

    elevation = base + wave_1 + wave_2 + wave_3 + ridge

    return round(max(0, elevation), 2)


def fetch_elevations_from_opentopodata(points, chunk_size=25):
    """
    Fetches real elevation data from OpenTopoData.

    Deployment-safe version:
    - uses smaller batches
    - tries GET first
    - falls back to POST per batch
    - allows partial missing points
    - fails if real DEM coverage is too low
    """

    all_elevations = []
    errors = []

    headers = {
        "User-Agent": "SAGIP-DEM-Prototype/0.1",
        "Accept": "application/json",
    }

    for start in range(0, len(points), chunk_size):
        chunk = points[start:start + chunk_size]

        locations_text = "|".join([
            f"{point['lat']:.6f},{point['lng']:.6f}"
            for point in chunk
        ])

        params = {
            "locations": locations_text,
            "interpolation": "bilinear",
        }

        try:
            response = requests.get(
                OPENTOPO_URL,
                params=params,
                timeout=20,
                headers=headers,
            )

            if response.status_code >= 400:
                response = requests.post(
                    OPENTOPO_URL,
                    data=params,
                    timeout=20,
                    headers=headers,
                )

            response.raise_for_status()

            data = response.json()

            if data.get("status") != "OK":
                raise RuntimeError(
                    data.get("error", "OpenTopoData request failed."))

            results = data.get("results", [])

            if len(results) != len(chunk):
                raise RuntimeError(
                    "OpenTopoData returned an unexpected number of results.")

            for item in results:
                elevation = item.get("elevation")

                if elevation is None:
                    all_elevations.append(None)
                else:
                    all_elevations.append(float(elevation))

        except Exception as error:
            errors.append(f"Batch {start // chunk_size + 1}: {str(error)}")

            for _ in chunk:
                all_elevations.append(None)

        time.sleep(0.12)

    real_count = sum(1 for value in all_elevations if value is not None)
    coverage = real_count / max(len(points), 1)

    if coverage < 0.35:
        short_errors = " | ".join(errors[:3])
        raise RuntimeError(
            f"OpenTopoData real DEM coverage too low: {coverage * 100:.1f}%. "
            f"Try 20×20 or 40×40 resolution, or retry later. "
            f"Errors: {short_errors}"
        )

    return all_elevations


def build_elevation_grid(points, elevations, resolution: int):
    """
    Converts flat list of elevations into a 2D grid.

    Missing real DEM points are filled by nearby real DEM interpolation.
    Full synthetic fallback is no longer allowed for deployment accuracy.
    """

    arr = np.full((resolution, resolution), np.nan, dtype=float)

    index = 0

    for row in range(resolution):
        for col in range(resolution):
            elevation = elevations[index]

            if elevation is not None:
                arr[row, col] = float(elevation)

            index += 1

    if np.isnan(arr).all():
        raise RuntimeError(
            "No real DEM values were returned. SAGIP refused to use synthetic terrain.")

    rows, cols = arr.shape

    for r in range(rows):
        for c in range(cols):
            if not np.isnan(arr[r, c]):
                continue

            filled = False

            for radius in range(1, 8):
                r1 = max(0, r - radius)
                r2 = min(rows, r + radius + 1)
                c1 = max(0, c - radius)
                c2 = min(cols, c + radius + 1)

                window = arr[r1:r2, c1:c2]
                valid = window[~np.isnan(window)]

                if valid.size > 0:
                    arr[r, c] = float(np.mean(valid))
                    filled = True
                    break

            if not filled:
                point_index = r * cols + c
                point = points[point_index]
                arr[r, c] = synthetic_elevation(point["lat"], point["lng"])

    return np.round(arr, 2).tolist()


def compute_slope_grid(elevation_grid, width_km: float, height_km: float):
    """
    Computes simple slope percentage for each grid cell using neighboring elevation differences.

    This is enough for flood susceptibility screening.
    Later, we can improve this with more advanced GIS slope methods.
    """

    arr = np.array(elevation_grid, dtype=float)

    rows, cols = arr.shape

    cell_width_m = max((width_km * 1000) / max(cols - 1, 1), 1)
    cell_height_m = max((height_km * 1000) / max(rows - 1, 1), 1)

    slope_grid = []

    for r in range(rows):
        slope_row = []

        for c in range(cols):
            left = arr[r, max(c - 1, 0)]
            right = arr[r, min(c + 1, cols - 1)]
            up = arr[max(r - 1, 0), c]
            down = arr[min(r + 1, rows - 1), c]

            dz_dx = (right - left) / (2 * cell_width_m)
            dz_dy = (down - up) / (2 * cell_height_m)

            slope_percent = math.sqrt(dz_dx ** 2 + dz_dy ** 2) * 100

            slope_row.append(round(float(slope_percent), 3))

        slope_grid.append(slope_row)

    return slope_grid


def detect_low_points(elevation_grid):
    """
    Finds cells that are lower than their surrounding neighbors.
    These are possible pooling/depression zones.
    """

    arr = np.array(elevation_grid, dtype=float)

    rows, cols = arr.shape
    low_points = []

    for r in range(1, rows - 1):
        for c in range(1, cols - 1):
            center = arr[r, c]

            neighbors = [
                arr[r - 1, c - 1],
                arr[r - 1, c],
                arr[r - 1, c + 1],
                arr[r, c - 1],
                arr[r, c + 1],
                arr[r + 1, c - 1],
                arr[r + 1, c],
                arr[r + 1, c + 1],
            ]

            if center <= min(neighbors):
                low_points.append({
                    "row": r,
                    "col": c,
                    "elevation": round(float(center), 2),
                })

    return low_points


def summarize_terrain(elevation_grid, slope_grid, low_points):
    """
    Creates summary numbers for frontend cards.
    """

    elevation_arr = np.array(elevation_grid, dtype=float)
    slope_arr = np.array(slope_grid, dtype=float)

    min_elev = float(np.min(elevation_arr))
    max_elev = float(np.max(elevation_arr))
    mean_elev = float(np.mean(elevation_arr))
    elev_range = max_elev - min_elev

    mean_slope = float(np.mean(slope_arr))
    max_slope = float(np.max(slope_arr))

    if elev_range < 10:
        terrain_type = "Mostly flat"
    elif elev_range < 50:
        terrain_type = "Gently varied"
    elif elev_range < 150:
        terrain_type = "Hilly / uneven"
    else:
        terrain_type = "Mountainous / steep"

    return {
        "min_elevation_m": round(min_elev, 2),
        "max_elevation_m": round(max_elev, 2),
        "mean_elevation_m": round(mean_elev, 2),
        "elevation_range_m": round(elev_range, 2),
        "mean_slope_percent": round(mean_slope, 3),
        "max_slope_percent": round(max_slope, 3),
        "low_point_count": len(low_points),
        "terrain_type": terrain_type,
    }


def generate_elevation_analysis(
    north: float,
    south: float,
    east: float,
    west: float,
    resolution: int,
    width_km: float,
    height_km: float,
):
    """
    Main terrain analysis pipeline.
    This is called by the FastAPI endpoint.
    """

    points, latitudes, longitudes = generate_grid_points(
        north=north,
        south=south,
        east=east,
        west=west,
        resolution=resolution,
    )

    source = "OpenTopoData SRTM 30m"
    warnings = []

    try:
        elevations = fetch_elevations_from_opentopodata(points)

    except Exception as error:
        raise RuntimeError(
            "Real DEM elevation fetch failed. SAGIP refused to use full synthetic terrain because it can create wrong flood projections. "
            f"Reason: {str(error)}"
        )

    real_count = sum(1 for value in elevations if value is not None)
    coverage = (real_count / max(len(elevations), 1)) * 100

    if coverage < 95:
        source = f"Partial OpenTopoData SRTM 30m + interpolation ({coverage:.1f}% real coverage)"
        warnings.append(
            f"Some DEM points were missing. SAGIP interpolated missing cells from nearby real DEM values. Real DEM coverage: {coverage:.1f}%."
        )
    else:
        source = f"OpenTopoData SRTM 30m ({coverage:.1f}% real coverage)"

    elevation_grid = build_elevation_grid(
        points=points,
        elevations=elevations,
        resolution=resolution,
    )

    slope_grid = compute_slope_grid(
        elevation_grid=elevation_grid,
        width_km=width_km,
        height_km=height_km,
    )

    low_points = detect_low_points(elevation_grid)

    summary = summarize_terrain(
        elevation_grid=elevation_grid,
        slope_grid=slope_grid,
        low_points=low_points,
    )

    return {
        "source": source,
        "resolution": resolution,
        "cell_count": resolution * resolution,
        "latitudes": latitudes,
        "longitudes": longitudes,
        "elevation_grid": elevation_grid,
        "slope_grid": slope_grid,
        "low_points": low_points[:100],
        "summary": summary,
        "warnings": warnings,
    }
