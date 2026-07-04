import math
import requests


OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]


def simplify_geometry(geometry, max_points=250):
    """
    Keeps water geometry light enough for frontend and 3D rendering.
    """

    if not geometry:
        return []

    if len(geometry) <= max_points:
        return geometry

    step = max(1, math.ceil(len(geometry) / max_points))

    simplified = geometry[::step]

    if simplified[-1] != geometry[-1]:
        simplified.append(geometry[-1])

    return simplified


def post_overpass(query: str):
    """
    Robust Overpass request helper.
    Tries multiple public Overpass servers.

    Uses form-style POST because it is accepted more reliably by public Overpass servers.
    """

    headers = {
        "User-Agent": "SAGIP-WaterBodyAnalyzer/0.1",
        "Accept": "application/json",
    }

    errors = []

    clean_query = query.strip()

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = requests.post(
                endpoint,
                data={"data": clean_query},
                timeout=60,
                headers=headers,
            )

            if response.status_code == 200:
                return response.json()

            errors.append(
                f"{endpoint} returned {response.status_code}: {response.text[:200]}"
            )

        except Exception as error:
            errors.append(f"{endpoint} error: {str(error)}")

    raise RuntimeError("All Overpass requests failed: " + " | ".join(errors))


def build_water_query(south: float, west: float, north: float, east: float):
    """
    Finds mapped water features inside the selected rectangle.

    This broader query catches more OpenStreetMap tagging styles:
    - waterway=river / stream / canal / drain / ditch
    - natural=water
    - water=river / lake / pond / reservoir / stream / canal
    - landuse=reservoir / basin
    - relations and ways
    """

    return f"""
    [out:json][timeout:60];
    (
      way["waterway"]({south},{west},{north},{east});
      relation["waterway"]({south},{west},{north},{east});

      way["natural"="water"]({south},{west},{north},{east});
      relation["natural"="water"]({south},{west},{north},{east});

      way["water"]({south},{west},{north},{east});
      relation["water"]({south},{west},{north},{east});

      way["landuse"~"^(reservoir|basin)$"]({south},{west},{north},{east});
      relation["landuse"~"^(reservoir|basin)$"]({south},{west},{north},{east});

      way["waterway"="riverbank"]({south},{west},{north},{east});
      relation["waterway"="riverbank"]({south},{west},{north},{east});
    );
    out body geom;
    """


def classify_water_feature(tags):
    """
    Converts OSM tags into SAGIP-friendly flood analysis categories.
    """

    waterway = str(tags.get("waterway", "")).lower()
    natural = str(tags.get("natural", "")).lower()
    water = str(tags.get("water", "")).lower()
    landuse = str(tags.get("landuse", "")).lower()

    if waterway in ["river", "riverbank"] or water == "river":
        return {
            "category": "River",
            "flood_role": "Potential overflow source during heavy rainfall",
            "overflow_importance": 0.95,
            "estimated_width_m": 35,
        }

    if waterway == "stream" or water == "stream":
        return {
            "category": "Stream",
            "flood_role": "Small channel that may rise quickly during intense rainfall",
            "overflow_importance": 0.65,
            "estimated_width_m": 8,
        }

    if waterway in ["canal", "drain", "ditch"] or water in ["canal", "drain", "ditch"]:
        return {
            "category": "Canal / Drainage",
            "flood_role": "May help drainage, but can overflow or clog during heavy rainfall",
            "overflow_importance": 0.55,
            "estimated_width_m": 5,
        }

    if (
        natural == "water"
        or water in ["lake", "pond", "reservoir", "basin"]
        or landuse in ["reservoir", "basin"]
    ):
        return {
            "category": "Lake / Pond / Reservoir",
            "flood_role": "Water storage area; surrounding lowlands may be flood-prone",
            "overflow_importance": 0.8,
            "estimated_width_m": 50,
        }

    if waterway:
        return {
            "category": "Other Waterway",
            "flood_role": f"Mapped waterway type '{waterway}' that may affect local flood behavior",
            "overflow_importance": 0.5,
            "estimated_width_m": 8,
        }

    return {
        "category": "Mapped Water Feature",
        "flood_role": "Mapped water feature that may affect local flood behavior",
        "overflow_importance": 0.5,
        "estimated_width_m": 10,
    }


def extract_feature_geometries(element):
    """
    Handles both normal ways and relation members.
    """

    geometries = []

    if element.get("geometry"):
        geometries.append(simplify_geometry(element["geometry"]))

    for member in element.get("members", []):
        if member.get("geometry"):
            geometries.append(simplify_geometry(member["geometry"]))

    return [geometry for geometry in geometries if len(geometry) >= 2]


def process_water_elements(elements):
    water_bodies = []

    for element in elements:
        tags = element.get("tags", {})

        is_water = (
            "waterway" in tags
            or str(tags.get("natural", "")).lower() == "water"
            or "water" in tags
            or str(tags.get("landuse", "")).lower() in ["reservoir", "basin"]
        )

        if not is_water:
            continue

        geometries = extract_feature_geometries(element)

        if not geometries:
            continue

        classification = classify_water_feature(tags)

        name = (
            tags.get("name")
            or tags.get("waterway")
            or tags.get("water")
            or tags.get("natural")
            or tags.get("landuse")
            or "Unnamed water feature"
        )

        water_bodies.append({
            "id": element.get("id"),
            "osm_type": element.get("type"),
            "name": name,
            "category": classification["category"],
            "flood_role": classification["flood_role"],
            "overflow_importance": classification["overflow_importance"],
            "estimated_width_m": classification["estimated_width_m"],
            "tags": tags,
            "geometries": geometries,
        })

    water_bodies.sort(
        key=lambda item: item.get("overflow_importance", 0),
        reverse=True,
    )

    return water_bodies


def scan_water_bodies(north: float, south: float, east: float, west: float):
    """
    Main water-body scanning function.
    """

    query = build_water_query(
        south=south,
        west=west,
        north=north,
        east=east,
    )

    data = post_overpass(query)

    elements = data.get("elements", [])

    water_bodies = process_water_elements(elements)

    raw_element_count = len(elements)

    river_count = sum(
        1 for item in water_bodies if item["category"] == "River")
    stream_count = sum(
        1 for item in water_bodies if item["category"] == "Stream")
    drainage_count = sum(
        1 for item in water_bodies if item["category"] == "Canal / Drainage")
    storage_count = sum(
        1 for item in water_bodies if item["category"] == "Lake / Pond / Reservoir")

    return {
        "water_bodies": water_bodies[:80],
        "summary": {
            "raw_osm_element_count": raw_element_count,
            "total_count": len(water_bodies),
            "returned_count": min(len(water_bodies), 80),
            "river_count": river_count,
            "stream_count": stream_count,
            "drainage_count": drainage_count,
            "storage_count": storage_count,
        },
        "source": "OpenStreetMap via Overpass API",
        "note": "Water geometry is mapped OSM data. Width, overflow importance, and flood role are planning proxies, not measured hydrologic values.",
    }
