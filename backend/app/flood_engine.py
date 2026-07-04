import math
import numpy as np


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def round_grid(grid, decimals=2):
    return np.round(grid.astype(float), decimals).tolist()


def build_low_point_grid(rows, cols, low_points):
    grid = np.zeros((rows, cols), dtype=float)

    for point in low_points or []:
        r = int(point.get("row", -1))
        c = int(point.get("col", -1))

        if 0 <= r < rows and 0 <= c < cols:
            grid[r, c] = 1.0

            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    rr = r + dr
                    cc = c + dc

                    if 0 <= rr < rows and 0 <= cc < cols:
                        distance = math.sqrt(dr * dr + dc * dc)
                        influence = max(0, 1 - distance / 3)
                        grid[rr, cc] = max(grid[rr, cc], influence)

    return grid


def get_terrain_bbox(terrain):
    latitudes = terrain.get("latitudes", [])
    longitudes = terrain.get("longitudes", [])

    return {
        "north": max(latitudes),
        "south": min(latitudes),
        "east": max(longitudes),
        "west": min(longitudes),
    }


def apply_water_influence(grid, center_row, center_col, importance, radius=4):
    rows, cols = grid.shape

    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            r = center_row + dr
            c = center_col + dc

            if r < 0 or r >= rows or c < 0 or c >= cols:
                continue

            distance = math.sqrt(dr * dr + dc * dc)
            influence = max(0, 1 - distance / (radius + 1)) * importance

            grid[r, c] = max(grid[r, c], influence)


def build_water_influence_grid(terrain, water_bodies):
    elevation_grid = np.array(terrain["elevation_grid"], dtype=float)
    rows, cols = elevation_grid.shape

    grid = np.zeros((rows, cols), dtype=float)

    if not water_bodies:
        return grid

    bbox = get_terrain_bbox(terrain)

    north = bbox["north"]
    south = bbox["south"]
    east = bbox["east"]
    west = bbox["west"]

    lat_range = max(north - south, 0.000001)
    lng_range = max(east - west, 0.000001)

    for feature in water_bodies:
        importance = float(feature.get("overflow_importance", 0.5))
        category = str(feature.get("category", "")).lower()

        radius = 5 if "river" in category or "reservoir" in category else 3

        for geometry in feature.get("geometries", []):
            for point in geometry:
                lat = point.get("lat")
                lon = point.get("lon")

                if lat is None or lon is None:
                    continue

                row = round(((north - lat) / lat_range) * (rows - 1))
                col = round(((lon - west) / lng_range) * (cols - 1))

                if 0 <= row < rows and 0 <= col < cols:
                    apply_water_influence(
                        grid, row, col, importance, radius=radius)

    return grid


def compute_lower_neighbor_grid(elevation_grid):
    rows, cols = elevation_grid.shape

    lower_neighbors = [[None for _ in range(cols)] for _ in range(rows)]

    directions = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),           (0, 1),
        (1, -1),  (1, 0),  (1, 1),
    ]

    for r in range(rows):
        for c in range(cols):
            current = elevation_grid[r, c]
            best = None
            best_elevation = current

            for dr, dc in directions:
                rr = r + dr
                cc = c + dc

                if rr < 0 or rr >= rows or cc < 0 or cc >= cols:
                    continue

                neighbor_elevation = elevation_grid[rr, cc]

                if neighbor_elevation < best_elevation:
                    best_elevation = neighbor_elevation
                    best = (rr, cc)

            lower_neighbors[r][c] = best

    return lower_neighbors


def classify_depth_cm(depth_cm):
    if depth_cm < 1:
        return "none"

    if depth_cm < 5:
        return "low"

    if depth_cm < 15:
        return "moderate"

    if depth_cm < 40:
        return "high"

    return "severe"


def summarize_depth_grid(depth_grid_mm, hour_index, timestamp):
    depth_cm = depth_grid_mm / 10.0

    rows, cols = depth_cm.shape

    counts = {
        "none": 0,
        "low": 0,
        "moderate": 0,
        "high": 0,
        "severe": 0,
    }

    class_grid = []

    for r in range(rows):
        class_row = []

        for c in range(cols):
            level = classify_depth_cm(depth_cm[r, c])
            counts[level] += 1
            class_row.append(level)

        class_grid.append(class_row)

    max_depth_cm = float(np.max(depth_cm))
    mean_depth_cm = float(np.mean(depth_cm))
    flooded_cells = rows * cols - counts["none"]

    return {
        "hour_index": hour_index,
        "time": timestamp,
        "max_depth_cm": round(max_depth_cm, 2),
        "mean_depth_cm": round(mean_depth_cm, 2),
        "flooded_cell_count": int(flooded_cells),
        "high_or_severe_cell_count": int(counts["high"] + counts["severe"]),
        "counts": counts,
        "depth_grid_cm": round_grid(depth_cm, 2),
        "class_grid": class_grid,
    }


def build_daily_summary(hourly_snapshots):
    daily = {}

    for snapshot in hourly_snapshots:
        day_index = int(snapshot["hour_index"] // 24)

        if day_index not in daily:
            daily[day_index] = {
                "day_index": day_index,
                "max_depth_cm": 0,
                "max_flooded_cells": 0,
                "max_high_or_severe_cells": 0,
                "peak_hour_index": snapshot["hour_index"],
                "peak_time": snapshot["time"],
            }

        if snapshot["max_depth_cm"] > daily[day_index]["max_depth_cm"]:
            daily[day_index]["max_depth_cm"] = snapshot["max_depth_cm"]
            daily[day_index]["peak_hour_index"] = snapshot["hour_index"]
            daily[day_index]["peak_time"] = snapshot["time"]

        daily[day_index]["max_flooded_cells"] = max(
            daily[day_index]["max_flooded_cells"],
            snapshot["flooded_cell_count"],
        )

        daily[day_index]["max_high_or_severe_cells"] = max(
            daily[day_index]["max_high_or_severe_cells"],
            snapshot["high_or_severe_cell_count"],
        )

    return list(daily.values())


def build_overall_summary(snapshots):
    if not snapshots:
        return {
            "peak_hour_index": None,
            "peak_time": None,
            "max_depth_cm": 0,
            "max_flooded_cells": 0,
            "max_high_or_severe_cells": 0,
            "overall_level": "No flood signal",
        }

    peak = max(snapshots, key=lambda item: item["max_depth_cm"])
    max_flooded = max(item["flooded_cell_count"] for item in snapshots)
    max_high_severe = max(item["high_or_severe_cell_count"]
                          for item in snapshots)

    max_depth = peak["max_depth_cm"]

    if max_depth >= 40:
        level = "Severe"
    elif max_depth >= 15:
        level = "High"
    elif max_depth >= 5:
        level = "Moderate"
    elif max_depth >= 1:
        level = "Low"
    else:
        level = "Minimal"

    return {
        "peak_hour_index": peak["hour_index"],
        "peak_time": peak["time"],
        "max_depth_cm": max_depth,
        "max_flooded_cells": int(max_flooded),
        "max_high_or_severe_cells": int(max_high_severe),
        "overall_level": level,
    }


def run_flood_simulation(
    terrain,
    forecast,
    water_bodies=None,
    snapshot_interval_hours=6,
    runoff_multiplier=1.0,
):
    elevation = np.array(terrain["elevation_grid"], dtype=float)
    slope = np.array(terrain["slope_grid"], dtype=float)

    rows, cols = elevation.shape

    min_elev = float(np.min(elevation))
    max_elev = float(np.max(elevation))
    elev_range = max(max_elev - min_elev, 1)

    normalized_elevation = (elevation - min_elev) / elev_range
    low_elevation_risk = 1 - normalized_elevation

    slope_norm = np.clip(slope / 12.0, 0, 1)
    flatness_risk = 1 - slope_norm

    low_point_grid = build_low_point_grid(
        rows=rows,
        cols=cols,
        low_points=terrain.get("low_points", []),
    )

    water_influence = build_water_influence_grid(
        terrain=terrain,
        water_bodies=water_bodies or [],
    )

    lower_neighbors = compute_lower_neighbor_grid(elevation)

    depth_mm = np.zeros((rows, cols), dtype=float)

    hourly = forecast.get("hourly", [])

    if not hourly:
        raise ValueError("Forecast does not contain hourly rainfall data.")

    snapshots = []
    hourly_summary = []

    snapshot_interval_hours = max(1, int(snapshot_interval_hours))

    for hour_index, hour in enumerate(hourly):
        rain_mm = float(hour.get("precipitation_mm",
                        hour.get("rain_mm", 0)) or 0)
        timestamp = hour.get("time", f"Hour {hour_index}")

        runoff_fraction = (
            0.20
            + low_elevation_risk * 0.30
            + flatness_risk * 0.20
            + low_point_grid * 0.20
            + water_influence * 0.12
        )

        runoff_fraction = np.clip(
            runoff_fraction * runoff_multiplier, 0.05, 0.95)

        rainfall_input = rain_mm * runoff_fraction

        river_overflow_pressure = np.maximum(
            0, rain_mm - 6) * water_influence * 0.65

        depth_mm += rainfall_input
        depth_mm += river_overflow_pressure

        infiltration_loss = (
            0.20
            + slope_norm * 0.30
            + (1 - low_point_grid) * 0.22
        )

        infiltration_loss = infiltration_loss * (1 - water_influence * 0.20)

        dry_loss = 0.12 if rain_mm < 0.1 else 0.03

        depth_mm -= infiltration_loss
        depth_mm -= dry_loss

        depth_mm = np.maximum(depth_mm, 0)

        transfer = np.zeros((rows, cols), dtype=float)

        for r in range(rows):
            for c in range(cols):
                neighbor = lower_neighbors[r][c]

                if neighbor is None:
                    continue

                rr, cc = neighbor

                outflow_rate = 0.035 + slope_norm[r, c] * 0.16
                outflow_amount = depth_mm[r, c] * outflow_rate

                transfer[r, c] -= outflow_amount
                transfer[rr, cc] += outflow_amount

        depth_mm += transfer
        depth_mm = np.maximum(depth_mm, 0)

        drainage_loss = (
            0.04
            + slope_norm * 0.16
            + water_influence * 0.10
        ) * (1 - low_point_grid * 0.45)

        depth_mm -= drainage_loss
        depth_mm = np.maximum(depth_mm, 0)

        compact_summary = summarize_depth_grid(depth_mm, hour_index, timestamp)

        hourly_summary.append({
            "hour_index": compact_summary["hour_index"],
            "time": compact_summary["time"],
            "max_depth_cm": compact_summary["max_depth_cm"],
            "mean_depth_cm": compact_summary["mean_depth_cm"],
            "flooded_cell_count": compact_summary["flooded_cell_count"],
            "high_or_severe_cell_count": compact_summary["high_or_severe_cell_count"],
        })

        is_snapshot_hour = hour_index % snapshot_interval_hours == 0
        is_last_hour = hour_index == len(hourly) - 1

        if is_snapshot_hour or is_last_hour:
            snapshots.append(compact_summary)

    daily_summary = build_daily_summary(hourly_summary)
    overall_summary = build_overall_summary(snapshots)

    return {
        "model": "SAGIP DEM-based rainfall accumulation simulation v0.1",
        "important_limitation": "This is a simplified terrain-based flood susceptibility and rainfall accumulation model, not a certified hydrodynamic flood model.",
        "rows": rows,
        "cols": cols,
        "snapshot_interval_hours": snapshot_interval_hours,
        "hour_count": len(hourly),
        "snapshot_count": len(snapshots),
        "snapshots": snapshots,
        "hourly_summary": hourly_summary,
        "daily_summary": daily_summary,
        "summary": overall_summary,
    }
