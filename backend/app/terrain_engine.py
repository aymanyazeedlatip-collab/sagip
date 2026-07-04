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


def fetch_elevations_from_opentopodata(points, chunk_size=100):
    """
    Fetches real elevation data from OpenTopoData.

    We use POST instead of GET because a large grid creates many coordinates.
    Sending thousands of points in a URL can break.
    """

    all_elevations = []

    for start in range(0, len(points), chunk_size):
        chunk = points[start:start + chunk_size]

        locations_text = "|".join([
            f"{point['lat']:.6f},{point['lng']:.6f}"
            for point in chunk
        ])

        payload = {
            "locations": locations_text,
            "interpolation": "bilinear",
        }

        response = requests.post(OPENTOPO_URL, data=payload, timeout=30)
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

        # Small pause so we do not hammer the public API.
        time.sleep(0.08)

    return all_elevations


def build_elevation_grid(points, elevations, resolution: int):
    """
    Converts flat list of elevations into a 2D grid.
    """

    grid = []

    index = 0

    for row in range(resolution):
        row_values = []

        for col in range(resolution):
            elevation = elevations[index]

            if elevation is None:
                point = points[index]
                elevation = synthetic_elevation(point["lat"], point["lng"])

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
        elevations = [
            synthetic_elevation(point["lat"], point["lng"])
            for point in points
        ]

        source = "Synthetic fallback terrain"
        warnings.append(
            f"Real elevation API failed, so SAGIP used synthetic fallback terrain. Reason: {str(error)}"
        )

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
