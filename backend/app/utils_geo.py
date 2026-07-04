import math


PH_LAT_MIN = 4.0
PH_LAT_MAX = 21.5
PH_LNG_MIN = 116.0
PH_LNG_MAX = 127.5


def is_bbox_in_philippines(north: float, south: float, east: float, west: float) -> bool:
    return (
        PH_LAT_MIN <= south <= PH_LAT_MAX
        and PH_LAT_MIN <= north <= PH_LAT_MAX
        and PH_LNG_MIN <= west <= PH_LNG_MAX
        and PH_LNG_MIN <= east <= PH_LNG_MAX
    )


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_km = 6371.0

    lat1_rad = math.radians(lat1)
    lng1_rad = math.radians(lng1)
    lat2_rad = math.radians(lat2)
    lng2_rad = math.radians(lng2)

    dlat = lat2_rad - lat1_rad
    dlng = lng2_rad - lng1_rad

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlng / 2) ** 2
    )

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return radius_km * c


def analyze_bbox(north: float, south: float, east: float, west: float, resolution: int):
    if north <= south:
        raise ValueError("North latitude must be greater than south latitude.")

    if east <= west:
        raise ValueError("East longitude must be greater than west longitude.")

    if not is_bbox_in_philippines(north, south, east, west):
        raise ValueError("Selected area must be inside the Philippines.")

    center_lat = (north + south) / 2
    center_lng = (east + west) / 2

    width_km = haversine_km(center_lat, west, center_lat, east)
    height_km = haversine_km(south, center_lng, north, center_lng)
    area_km2 = width_km * height_km

    warnings = []

    if area_km2 > 100:
        warnings.append(
            "Selected area is municipality-scale. Use this for broad screening, not street-level detail.")

    if area_km2 > 400:
        warnings.append(
            "Large municipality scan detected. Use lower grid resolution for faster simulation.")

    if area_km2 > 900:
        warnings.append(
            "Very large scan area. DEM and flood simulation may be slow or less detailed.")

    if area_km2 > 1600:
        warnings.append(
            "Maximum prototype scan reached. For accurate results, scan smaller zones inside the municipality.")

    if resolution > 50:
        warnings.append(
            "High-resolution DEM selected. This gives more detailed terrain, but takes longer to generate.")

    if resolution > 60 and area_km2 > 25:
        warnings.append(
            "80 × 80 resolution is best for smaller areas. For large scans, use 20 × 20, 25 × 25, or 30 × 30.")

    if resolution > 60 and area_km2 > 100:
        warnings.append(
            "High resolution with a municipality-scale area may be slow. Consider using 25 × 25 or 30 × 30.")

    return {
        "center_lat": round(center_lat, 6),
        "center_lng": round(center_lng, 6),
        "width_km": round(width_km, 3),
        "height_km": round(height_km, 3),
        "area_km2": round(area_km2, 3),
        "resolution": resolution,
        "cell_count": resolution * resolution,
        "warnings": warnings,
    }
