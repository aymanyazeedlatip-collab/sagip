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


def fetch_elevations_from_opentopodata(points, chunk_size=20, max_attempts=6):
    """
    Fetches 100% real DEM elevation data from OpenTopoData.

    Strict mode:
    - No synthetic fallback
    - No interpolation fallback
    - Retries failed batches
    - Retries missing points individually
    - Fails if even one point is missing
    """

    all_elevations = [None for _ in points]

    headers = {
        "User-Agent": "SAGIP-RealDEM-Strict/1.0",
        "Accept": "application/json",
    }

    def request_batch(batch_points):
        locations_text = "|".join([
            f"{point['lat']:.6f},{point['lng']:.6f}"
            for point in batch_points
        ])

        payload = {
            "locations": locations_text,
            "interpolation": "bilinear",
        }

        last_error = None

        for attempt in range(1, max_attempts + 1):
            try:
                response = requests.post(
                    OPENTOPO_URL,
                    data=payload,
                    timeout=60,
                    headers=headers,
                )

                if response.status_code >= 400:
                    response = requests.get(
                        OPENTOPO_URL,
                        params=payload,
                        timeout=60,
                        headers=headers,
                    )

                response.raise_for_status()

                data = response.json()

                if data.get("status") != "OK":
                    raise RuntimeError(
                        data.get("error", "OpenTopoData request failed.")
                    )

                results = data.get("results", [])

                if len(results) != len(batch_points):
                    raise RuntimeError(
                        f"OpenTopoData returned {len(results)} results for {len(batch_points)} requested points."
                    )

                return results

            except Exception as error:
                last_error = error
                time.sleep(0.8 * attempt)

        raise RuntimeError(
            f"OpenTopoData batch failed after {max_attempts} attempts. Last error: {last_error}"
        )

    for start in range(0, len(points), chunk_size):
        chunk = points[start:start + chunk_size]

        results = request_batch(chunk)

        for offset, item in enumerate(results):
            elevation = item.get("elevation")

            if elevation is not None:
                all_elevations[start + offset] = float(elevation)

        time.sleep(0.18)

    missing_indexes = [
        index for index, elevation in enumerate(all_elevations)
        if elevation is None
    ]

    if missing_indexes:
        for index in missing_indexes:
            point = points[index]

            results = request_batch([point])
            elevation = results[0].get("elevation")

            if elevation is not None:
                all_elevations[index] = float(elevation)

            time.sleep(0.15)

    final_missing = [
        index for index, elevation in enumerate(all_elevations)
        if elevation is None
    ]

    if final_missing:
        missing_samples = []

        for index in final_missing[:8]:
            point = points[index]
            missing_samples.append(
                f"row {point['row']}, col {point['col']}, lat {point['lat']:.6f}, lng {point['lng']:.6f}"
            )

        raise RuntimeError(
            "100% real DEM requirement failed. "
            f"{len(final_missing)} of {len(points)} DEM points returned no real elevation value. "
            "SAGIP refused to use synthetic, interpolated, or fake terrain. "
            "Retry later, move the rectangle slightly, or use a smaller/lower-resolution area. "
            f"Missing samples: {' | '.join(missing_samples)}"
        )

    return all_elevations


def build_elevation_grid(points, elevations, resolution: int):
    """
    Converts 100% real DEM elevation values into a 2D grid.

    Strict mode:
    - No synthetic fill
    - No interpolation fill
    - Any missing elevation fails the request
    """

    if len(elevations) != len(points):
        raise RuntimeError(
            f"Elevation count mismatch. Expected {len(points)} values, got {len(elevations)}."
        )

    missing_indexes = [
        index for index, elevation in enumerate(elevations)
        if elevation is None
    ]

    if missing_indexes:
        missing_samples = []

        for index in missing_indexes[:8]:
            point = points[index]
            missing_samples.append(
                f"row {point['row']}, col {point['col']}, lat {point['lat']:.6f}, lng {point['lng']:.6f}"
            )

        raise RuntimeError(
            "DEM grid contains missing real elevation values. "
            f"Missing cells: {len(missing_indexes)}. "
            "SAGIP refused to use synthetic or interpolated terrain. "
            f"Missing samples: {' | '.join(missing_samples)}"
        )

    grid = []

    index = 0

    for row in range(resolution):
        row_values = []

        for col in range(resolution):
            elevation = elevations[index]
            row_values.append(round(float(elevation), 2))
            index += 1

        grid.append(row_values)

    return grid


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
            "Real DEM elevation fetch failed. "
            "SAGIP is in strict 100% real DEM mode, so synthetic terrain and interpolation are disabled. "
            f"Reason: {str(error)}"
        )

    real_count = sum(1 for value in elevations if value is not None)
    coverage = (real_count / max(len(elevations), 1)) * 100

    if coverage < 100:
        raise RuntimeError(
            f"100% real DEM requirement failed. Real DEM coverage is only {coverage:.2f}%. "
            "SAGIP refused to generate terrain because fake/interpolated cells are disabled."
        )

    source = f"OpenTopoData SRTM 30m — 100% real DEM coverage ({coverage:.1f}%)"

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
