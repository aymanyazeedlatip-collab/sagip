import math
import requests
from collections import defaultdict


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def round_value(value, decimals=2):
    try:
        return round(float(value), decimals)
    except Exception:
        return 0


def safe_list_get(values, index, default=0):
    if not values:
        return default

    if index >= len(values):
        return default

    value = values[index]

    if value is None:
        return default

    return value


def classify_daily_rainfall(total_mm: float):
    """
    Simple rainfall intensity class for school/research prototype.

    This is not a government warning standard.
    It is only used to help SAGIP interpret rainfall severity before flood simulation.
    """

    if total_mm <= 0:
        return "No rain"

    if total_mm < 10:
        return "Low"

    if total_mm < 25:
        return "Moderate"

    if total_mm < 50:
        return "Heavy"

    return "Extreme"


def build_recommendation_hint(level: str):
    if level == "Extreme":
        return "Extreme rainfall forecast detected. Prioritize flood-prone lowlands, river-adjacent zones, and evacuation readiness."

    if level == "Heavy":
        return "Heavy rainfall forecast detected. Monitor low-lying areas, rivers, streams, and drainage systems."

    if level == "Moderate":
        return "Moderate rainfall forecast detected. Continue monitoring terrain depressions and water-adjacent communities."

    if level == "Low":
        return "Low rainfall forecast detected. Flood risk may remain localized unless terrain drainage is poor."

    return "No significant rainfall detected in the forecast period."


def weather_code_to_condition(code):
    """
    Converts Open-Meteo weather codes into readable condition labels.
    """

    try:
        code = int(code)
    except Exception:
        return "Unknown"

    weather_map = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Rime fog",
        51: "Light drizzle",
        53: "Drizzle",
        55: "Heavy drizzle",
        56: "Freezing drizzle",
        57: "Heavy freezing drizzle",
        61: "Light rain",
        63: "Rain",
        65: "Heavy rain",
        66: "Freezing rain",
        67: "Heavy freezing rain",
        71: "Light snow",
        73: "Snow",
        75: "Heavy snow",
        77: "Snow grains",
        80: "Light rain showers",
        81: "Rain showers",
        82: "Violent rain showers",
        85: "Snow showers",
        86: "Heavy snow showers",
        95: "Thunderstorm",
        96: "Thunderstorm with hail",
        99: "Severe thunderstorm with hail",
    }

    return weather_map.get(code, "Unknown")


def weather_code_to_icon(code):
    """
    Simple emoji icon for the calendar cards.
    """

    try:
        code = int(code)
    except Exception:
        return "🌦️"

    if code == 0:
        return "☀️"

    if code in [1, 2]:
        return "🌤️"

    if code == 3:
        return "☁️"

    if code in [45, 48]:
        return "🌫️"

    if code in [51, 53, 55, 56, 57]:
        return "🌦️"

    if code in [61, 63, 65, 66, 67, 80, 81, 82]:
        return "🌧️"

    if code in [95, 96, 99]:
        return "⛈️"

    return "🌦️"


def build_daily_forecast_advice(level: str, condition: str):
    condition_lower = condition.lower()

    if level == "Extreme":
        return "Extreme rainfall possible. Prepare flood monitoring, drainage inspection, and emergency readiness."

    if level == "Heavy":
        return "Heavy rainfall expected. Monitor low-lying areas, water bodies, roads, and evacuation routes."

    if "thunderstorm" in condition_lower:
        return "Thunderstorm risk. Watch for rapid runoff, river rise, and localized flooding."

    if level == "Moderate":
        return "Moderate rainfall. Continue monitoring low points and water-adjacent zones."

    if level == "Low":
        return "Low rainfall. Flooding may remain localized unless drainage is poor."

    return "No significant rainfall expected. Continue normal monitoring."


def create_synthetic_forecast(latitude: float, longitude: float, forecast_days: int, reason: str):
    """
    Backup forecast generator.
    This keeps the prototype working if Open-Meteo is unavailable.

    This is NOT real weather data.
    """

    hourly = []
    daily_totals = defaultdict(float)

    for hour_index in range(forecast_days * 24):
        day_index = hour_index // 24
        hour_of_day = hour_index % 24

        wave = math.sin((latitude + longitude + hour_index) * 0.35)
        afternoon_boost = 1.0 if 13 <= hour_of_day <= 19 else 0.35

        rain_mm = 0

        if day_index in [2, 3, 6]:
            rain_mm = max(0, (wave + 1.1) * afternoon_boost * 2.2)

        if day_index == 7:
            rain_mm = max(0, (wave + 1.3) * afternoon_boost * 4.0)

        rain_mm = round_value(rain_mm, 2)

        date_key = f"Demo Day {day_index + 1}"
        daily_totals[date_key] += rain_mm

        hourly.append({
            "hour_index": hour_index,
            "time": f"Demo Day {day_index + 1}, Hour {hour_of_day:02d}:00",
            "precipitation_mm": rain_mm,
            "rain_mm": rain_mm,
            "precipitation_probability_percent": 60 if rain_mm > 0 else 20,
        })

    daily = []

    for day_index, (date_key, total) in enumerate(daily_totals.items()):
        total = round_value(total, 2)
        daily.append({
            "day_index": day_index,
            "date": date_key,
            "precipitation_sum_mm": total,
            "rain_sum_mm": total,
            "precipitation_probability_max_percent": 60 if total > 0 else 20,
            "level": classify_daily_rainfall(total),
        })

    summary = summarize_forecast(hourly, daily)

    return {
        "source": "Synthetic fallback rainfall forecast",
        "latitude": latitude,
        "longitude": longitude,
        "forecast_days": forecast_days,
        "hourly": hourly,
        "daily": daily,
        "summary": summary,
        "warnings": [
            f"Open-Meteo forecast failed, so SAGIP used synthetic fallback rainfall. Reason: {reason}",
            "Synthetic rainfall is for demo continuity only and must not be used as real forecast data."
        ],
    }


def summarize_forecast(hourly, daily):
    total_rainfall = sum(day["precipitation_sum_mm"] for day in daily)
    wet_days = sum(1 for day in daily if day["precipitation_sum_mm"] > 0)

    peak_day = None
    peak_hour = None

    max_daily = -1
    for day in daily:
        if day["precipitation_sum_mm"] > max_daily:
            max_daily = day["precipitation_sum_mm"]
            peak_day = day

    max_hourly = -1
    for hour in hourly:
        if hour["precipitation_mm"] > max_hourly:
            max_hourly = hour["precipitation_mm"]
            peak_hour = hour

    peak_level = classify_daily_rainfall(max_daily)
    recommendation = build_recommendation_hint(peak_level)

    return {
        "total_forecast_rainfall_mm": round_value(total_rainfall, 2),
        "total_10_day_rainfall_mm": round_value(total_rainfall, 2),
        "wet_day_count": wet_days,
        "max_daily_rainfall_mm": round_value(max_daily, 2),
        "peak_day_index": peak_day["day_index"] if peak_day else None,
        "peak_day_date": peak_day["date"] if peak_day else None,
        "peak_day_level": peak_level,
        "peak_hour_index": peak_hour["hour_index"] if peak_hour else None,
        "peak_hour_time": peak_hour["time"] if peak_hour else None,
        "peak_hourly_rainfall_mm": round_value(max_hourly, 2),
        "recommendation_hint": recommendation,
    }


def fetch_open_meteo_forecast(latitude: float, longitude: float, forecast_days: int = 16):
    """
    Fetches hourly and daily rainfall forecast from Open-Meteo.

    forecast_days=10 gives SAGIP the 10-day forecast timeline.
    """

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "precipitation,rain,precipitation_probability,temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,precipitation_probability_max,wind_speed_10m_max",
        "forecast_days": forecast_days,
        "timezone": "auto",
    }

    response = requests.get(
        OPEN_METEO_URL,
        params=params,
        timeout=30,
    )

    response.raise_for_status()

    data = response.json()

    if "hourly" not in data or "daily" not in data:
        raise RuntimeError(
            "Open-Meteo response did not include hourly and daily forecast data.")

    hourly_raw = data["hourly"]
    daily_raw = data["daily"]

    hourly_times = hourly_raw.get("time", [])
    hourly_precipitation = hourly_raw.get("precipitation", [])
    hourly_rain = hourly_raw.get("rain", [])
    hourly_probability = hourly_raw.get("precipitation_probability", [])
    hourly_temperature = hourly_raw.get("temperature_2m", [])
    hourly_humidity = hourly_raw.get("relative_humidity_2m", [])
    hourly_dew_point = hourly_raw.get("dew_point_2m", [])
    hourly_wind_speed = hourly_raw.get("wind_speed_10m", [])

    hourly = []

    for index, timestamp in enumerate(hourly_times):
        precipitation_mm = round_value(
            safe_list_get(hourly_precipitation, index, 0), 2)
        rain_mm = round_value(safe_list_get(
            hourly_rain, index, precipitation_mm), 2)
        probability = round_value(safe_list_get(
            hourly_probability, index, 0), 0)
        temperature = round_value(safe_list_get(
            hourly_temperature, index, 0), 2)
        humidity = round_value(safe_list_get(
            hourly_humidity, index, 0), 2)
        dew_point = round_value(safe_list_get(
            hourly_dew_point, index, 0), 2)
        wind_speed = round_value(safe_list_get(
            hourly_wind_speed, index, 0), 2)

        hourly.append({
            "hour_index": index,
            "time": timestamp,
            "precipitation_mm": precipitation_mm,
            "rain_mm": rain_mm,
            "precipitation_probability_percent": probability,
            "temperature_2m_c": temperature,
            "relative_humidity_2m_percent": humidity,
            "dew_point_2m_c": dew_point,
            "wind_speed_10m_kmh": wind_speed,
        })

    daily_dates = daily_raw.get("time", [])
    daily_weather_code = daily_raw.get("weather_code", [])
    daily_temp_max = daily_raw.get("temperature_2m_max", [])
    daily_temp_min = daily_raw.get("temperature_2m_min", [])
    daily_precipitation = daily_raw.get("precipitation_sum", [])
    daily_rain = daily_raw.get("rain_sum", [])
    daily_probability = daily_raw.get("precipitation_probability_max", [])
    daily_wind_max = daily_raw.get("wind_speed_10m_max", [])

    daily = []

    for index, date in enumerate(daily_dates):
        precipitation_sum = round_value(
            safe_list_get(daily_precipitation, index, 0), 2)
        rain_sum = round_value(safe_list_get(
            daily_rain, index, precipitation_sum), 2)
        probability_max = round_value(
            safe_list_get(daily_probability, index, 0), 0)
        weather_code = safe_list_get(daily_weather_code, index, None)
        condition = weather_code_to_condition(weather_code)
        icon = weather_code_to_icon(weather_code)
        temp_max = round_value(safe_list_get(daily_temp_max, index, 0), 1)
        temp_min = round_value(safe_list_get(daily_temp_min, index, 0), 1)
        wind_max = round_value(safe_list_get(daily_wind_max, index, 0), 1)
        level = classify_daily_rainfall(precipitation_sum)

        daily.append({
            "day_index": index,
            "date": date,
            "weather_code": weather_code,
            "condition": condition,
            "icon": icon,
            "temperature_max_c": temp_max,
            "temperature_min_c": temp_min,
            "precipitation_sum_mm": precipitation_sum,
            "rain_sum_mm": rain_sum,
            "precipitation_probability_max_percent": probability_max,
            "wind_speed_10m_max_kmh": wind_max,
            "level": level,
            "advice": build_daily_forecast_advice(level, condition),
        })

    summary = summarize_forecast(hourly, daily)

    return {
        "source": "Open-Meteo Forecast API",
        "latitude": latitude,
        "longitude": longitude,
        "forecast_days": forecast_days,
        "hourly": hourly,
        "daily": daily,
        "summary": summary,
        "warnings": [],
    }


def get_rainfall_forecast(latitude: float, longitude: float, forecast_days: int = 16):
    """
    Main weather function used by the API endpoint.
    """

    try:
        return fetch_open_meteo_forecast(
            latitude=latitude,
            longitude=longitude,
            forecast_days=forecast_days,
        )

    except Exception as error:
        return create_synthetic_forecast(
            latitude=latitude,
            longitude=longitude,
            forecast_days=forecast_days,
            reason=str(error),
        )
