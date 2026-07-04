from pydantic import BaseModel, Field


class RectangleAreaRequest(BaseModel):
    north: float = Field(..., description="Northern latitude boundary")
    south: float = Field(..., description="Southern latitude boundary")
    east: float = Field(..., description="Eastern longitude boundary")
    west: float = Field(..., description="Western longitude boundary")
    resolution: int = Field(
        40, ge=10, le=80, description="Grid resolution per side")


class AreaAnalysisResponse(BaseModel):
    center_lat: float
    center_lng: float
    width_km: float
    height_km: float
    area_km2: float
    resolution: int
    cell_count: int
    warnings: list[str]


class ElevationGridRequest(BaseModel):
    north: float = Field(..., description="Northern latitude boundary")
    south: float = Field(..., description="Southern latitude boundary")
    east: float = Field(..., description="Eastern longitude boundary")
    west: float = Field(..., description="Western longitude boundary")
    resolution: int = Field(
        40,
        ge=10,
        le=80,
        description="Grid resolution per side"
    )


class WaterBodiesRequest(BaseModel):
    north: float = Field(..., description="Northern latitude boundary")
    south: float = Field(..., description="Southern latitude boundary")
    east: float = Field(..., description="Eastern longitude boundary")
    west: float = Field(..., description="Western longitude boundary")


class WeatherForecastRequest(BaseModel):
    north: float = Field(..., description="Northern latitude boundary")
    south: float = Field(..., description="Southern latitude boundary")
    east: float = Field(..., description="Eastern longitude boundary")
    west: float = Field(..., description="Western longitude boundary")
    forecast_days: int = Field(
        10,
        ge=1,
        le=16,
        description="Forecast length in days"
    )


class FloodSimulationRequest(BaseModel):
    terrain: dict = Field(...,
                          description="Terrain object from /api/elevation-grid")
    forecast: dict = Field(...,
                           description="Forecast object from /api/weather/forecast")
    water_bodies: list = Field(
        default_factory=list, description="Water bodies from /api/water-bodies")
    snapshot_interval_hours: int = Field(
        6,
        ge=1,
        le=24,
        description="How often full flood grid snapshots are stored"
    )
    runoff_multiplier: float = Field(
        1.0,
        ge=0.2,
        le=3.0,
        description="Scenario multiplier for runoff intensity"
    )
