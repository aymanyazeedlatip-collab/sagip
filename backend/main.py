import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.schemas import RectangleAreaRequest, ElevationGridRequest, WaterBodiesRequest, WeatherForecastRequest, FloodSimulationRequest
from app.utils_geo import analyze_bbox
from app.terrain_engine import generate_elevation_analysis
from app.water_engine import scan_water_bodies
from app.weather_engine import get_rainfall_forecast
from app.flood_engine import run_flood_simulation


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")


app = FastAPI(
    title="SAGIP API",
    description="Spatial Analytics and Geospatial Inundation Projection for Flood Early Warning and Emergency Response",
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def root():
    index_path = os.path.join(FRONTEND_DIR, "index.html")

    if os.path.exists(index_path):
        return FileResponse(index_path)

    return {
        "app": "SAGIP",
        "message": "SAGIP API is running, but frontend/index.html was not found.",
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": "SAGIP",
        "version": "0.1.0",
        "description": "Flood early warning and DEM-based inundation projection prototype",
    }


@app.post("/api/area/analyze")
def analyze_selected_area(payload: RectangleAreaRequest):
    try:
        result = analyze_bbox(
            north=payload.north,
            south=payload.south,
            east=payload.east,
            west=payload.west,
            resolution=payload.resolution,
        )

        return {
            "status": "success",
            "area": result,
        }

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/elevation-grid")
def generate_elevation_grid(payload: ElevationGridRequest):
    try:
        area = analyze_bbox(
            north=payload.north,
            south=payload.south,
            east=payload.east,
            west=payload.west,
            resolution=payload.resolution,
        )

        if area["cell_count"] > 6400:
            raise ValueError(
                "DEM grid is too large for the current prototype. Use 80 × 80 resolution or lower."
            )

        terrain = generate_elevation_analysis(
            north=payload.north,
            south=payload.south,
            east=payload.east,
            west=payload.west,
            resolution=payload.resolution,
            width_km=area["width_km"],
            height_km=area["height_km"],
        )

        return {
            "status": "success",
            "area": area,
            "terrain": terrain,
        }

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    except Exception as error:
        raise HTTPException(
            status_code=500, detail=f"Elevation grid failed: {str(error)}")


@app.post("/api/water-bodies")
def get_water_bodies(payload: WaterBodiesRequest):
    try:
        area = analyze_bbox(
            north=payload.north,
            south=payload.south,
            east=payload.east,
            west=payload.west,
            resolution=20,
        )

        if area["area_km2"] > 1800:
            raise ValueError(
                "Selected area is too large for water-body scanning. Use 40 km × 40 km or smaller."
            )

        water_result = scan_water_bodies(
            north=payload.north,
            south=payload.south,
            east=payload.east,
            west=payload.west,
        )

        return {
            "status": "success",
            "area": area,
            "water": water_result,
        }

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    except Exception as error:
        raise HTTPException(
            status_code=500, detail=f"Water-body scan failed: {str(error)}")


@app.post("/api/weather/forecast")
def get_weather_forecast(payload: WeatherForecastRequest):
    try:
        area = analyze_bbox(
            north=payload.north,
            south=payload.south,
            east=payload.east,
            west=payload.west,
            resolution=20,
        )

        forecast = get_rainfall_forecast(
            latitude=area["center_lat"],
            longitude=area["center_lng"],
            forecast_days=payload.forecast_days,
        )

        return {
            "status": "success",
            "area": area,
            "forecast": forecast,
        }

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Weather forecast failed: {str(error)}"
        )


@app.post("/api/flood/simulate")
def simulate_flood(payload: FloodSimulationRequest):
    try:
        result = run_flood_simulation(
            terrain=payload.terrain,
            forecast=payload.forecast,
            water_bodies=payload.water_bodies,
            snapshot_interval_hours=payload.snapshot_interval_hours,
            runoff_multiplier=payload.runoff_multiplier,
        )

        return {
            "status": "success",
            "simulation": result,
        }

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Flood simulation failed: {str(error)}"
        )
