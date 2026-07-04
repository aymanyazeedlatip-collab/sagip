const SAGIP_FORECAST_API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:8000"
        : window.location.origin;

function getForecastBbox() {
    if (window.latestTerrainData && window.latestTerrainData.terrain) {
        const latitudes = window.latestTerrainData.terrain.latitudes || [];
        const longitudes = window.latestTerrainData.terrain.longitudes || [];

        if (latitudes.length > 0 && longitudes.length > 0) {
            return {
                north: Math.max(...latitudes),
                south: Math.min(...latitudes),
                east: Math.max(...longitudes),
                west: Math.min(...longitudes),
            };
        }
    }

    if (typeof getSelectedBbox === "function") {
        return getSelectedBbox();
    }

    return null;
}

async function fetchRainfallForecastForLatestArea() {
    const bbox = getForecastBbox();

    if (!bbox) {
        alert("Please select an area or generate a DEM grid first.");
        switchTab("area");
        return;
    }

    switchTab("simulation");

    setTimeout(() => {
        setRainfallStatus("Fetching", "loading");
        showRainfallLoading();
    }, 150);

    const payload = {
        north: bbox.north,
        south: bbox.south,
        east: bbox.east,
        west: bbox.west,
        forecast_days: 16,
    };

    try {
        const response = await fetch(`${SAGIP_FORECAST_API_BASE}/api/weather/forecast`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Rainfall forecast failed.");
        }

        window.latestRainfallForecast = data;
        renderRainfallForecast(data);

    } catch (error) {
        setRainfallStatus("Failed", "error");

        const interpretation = document.getElementById("rainfall-interpretation");
        if (interpretation) {
            interpretation.textContent = `Rainfall forecast failed: ${error.message}`;
        }

        const bars = document.getElementById("rainfall-daily-bars");
        if (bars) {
            bars.innerHTML = `
                <div class="rainfall-empty">
                    Forecast failed. Check backend terminal and /api/weather/forecast in FastAPI docs.
                </div>
            `;
        }
    }
}

function showRainfallLoading() {
    const bars = document.getElementById("rainfall-daily-bars");

    if (bars) {
        bars.innerHTML = `
            <div class="rainfall-empty">
                Fetching 16-day rainfall forecast...
            </div>
        `;
    }

    const source = document.getElementById("rainfall-source");
    if (source) {
        source.textContent = "Loading forecast source...";
    }
}

function renderRainfallForecast(data) {
    const forecast = data.forecast;
    const summary = forecast.summary;

    const isFallback = forecast.source.toLowerCase().includes("synthetic");

    setRainfallStatus(isFallback ? "Fallback" : "Loaded", isFallback ? "warning" : "success");

    updateRainfallSummary(summary);
    renderRainfallBars(forecast.daily);
    renderForecastCalendar(forecast.daily);
    renderRainfallWarnings(forecast.warnings || []);
    renderRainfallInterpretation(summary);

    const source = document.getElementById("rainfall-source");
    if (source) {
        source.textContent = forecast.source;
    }
}

function updateRainfallSummary(summary) {
    const total = document.getElementById("rainfall-total");
    const wetDays = document.getElementById("rainfall-wet-days");
    const peakDay = document.getElementById("rainfall-peak-day");
    const peakHour = document.getElementById("rainfall-peak-hour");

    const forecastTotal =
        summary.total_forecast_rainfall_mm ??
        summary.total_10_day_rainfall_mm ??
        0;

    if (total) total.textContent = `${forecastTotal} mm`;
    if (wetDays) wetDays.textContent = `${summary.wet_day_count}`;
    if (peakDay) peakDay.textContent = summary.peak_day_date || "—";
    if (peakHour) peakHour.textContent = `${summary.peak_hourly_rainfall_mm} mm`;
}

function renderRainfallBars(dailyForecast) {
    const bars = document.getElementById("rainfall-daily-bars");

    if (!bars) return;

    if (!dailyForecast || dailyForecast.length === 0) {
        bars.innerHTML = `
            <div class="rainfall-empty">
                No daily rainfall data was returned.
            </div>
        `;
        return;
    }

    const maxRain = Math.max(
        ...dailyForecast.map((day) => Number(day.precipitation_sum_mm || 0)),
        1
    );

    bars.innerHTML = dailyForecast.map((day) => {
        const amount = Number(day.precipitation_sum_mm || 0);
        const width = Math.max(2, (amount / maxRain) * 100);
        const level = day.level || "No rain";
        const levelClass = getRainLevelClass(level);

        return `
            <div class="rainfall-day-row">
                <div class="rainfall-day-label">
                    Day ${day.day_index + 1}<br>
                    <small>${day.date}</small>
                </div>

                <div class="rainfall-bar-track">
                    <div class="rainfall-bar-fill" style="width: ${width}%;"></div>
                </div>

                <div class="rainfall-day-amount">
                    ${amount.toFixed(2)} mm
                </div>

                <div class="rainfall-day-level ${levelClass}">
                    ${level}
                </div>
            </div>
        `;
    }).join("");
}

function getRainLevelClass(level) {
    const normalized = String(level).toLowerCase().replaceAll(" ", "-");

    if (normalized === "no-rain") return "rain-level-no-rain";
    if (normalized === "low") return "rain-level-low";
    if (normalized === "moderate") return "rain-level-moderate";
    if (normalized === "heavy") return "rain-level-heavy";
    if (normalized === "extreme") return "rain-level-extreme";

    return "rain-level-low";
}

function renderRainfallWarnings(warnings) {
    const warningBox = document.getElementById("rainfall-warning-box");

    if (!warningBox) return;

    if (!warnings || warnings.length === 0) {
        warningBox.classList.add("hidden");
        warningBox.innerHTML = "";
        return;
    }

    warningBox.classList.remove("hidden");
    warningBox.innerHTML = `
        <h4>Forecast Warnings</h4>
        ${warnings.map((warning) => `<p>${escapeForecastHtml(warning)}</p>`).join("")}
    `;
}

function renderRainfallInterpretation(summary) {
    const interpretation = document.getElementById("rainfall-interpretation");

    if (!interpretation) return;

    interpretation.textContent =
        `${summary.recommendation_hint} ` +
        `Peak daily rainfall is ${summary.max_daily_rainfall_mm} mm on ${summary.peak_day_date}. ` +
        `Peak hourly rainfall is ${summary.peak_hourly_rainfall_mm} mm.`;
}

function setRainfallStatus(text, type) {
    const status = document.getElementById("rainfall-status");

    if (!status) return;

    status.textContent = text;
    status.className = `rainfall-badge ${type || ""}`;
}

function escapeForecastHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function renderForecastCalendar(dailyForecast) {
    const calendarGrid = document.getElementById("forecast-calendar-grid");

    if (!calendarGrid) return;

    if (!dailyForecast || dailyForecast.length === 0) {
        calendarGrid.innerHTML = `
            <div class="rainfall-empty">
                No calendar forecast data available.
            </div>
        `;
        return;
    }

    const firstDate = parseForecastDate(dailyForecast[0].date);
    const firstDayOffset = firstDate ? firstDate.getDay() : 0;

    let cellsHtml = "";

    for (let i = 0; i < firstDayOffset; i++) {
        cellsHtml += `<div class="forecast-calendar-cell forecast-calendar-empty"></div>`;
    }

    cellsHtml += dailyForecast.map((day) => buildForecastCalendarCard(day)).join("");

    calendarGrid.innerHTML = cellsHtml;
}

function buildForecastCalendarCard(day) {
    const dateObj = parseForecastDate(day.date);
    const dateLabel = formatForecastDate(day.date);
    const weekday = dateObj
        ? dateObj.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()
        : `DAY ${day.day_index + 1}`;

    const level = day.level || "No rain";
    const levelClass = getRainLevelClass(level);
    const severityClass = getCalendarSeverityClass(level);

    const probability = Number(day.precipitation_probability_max_percent || 0);
    const rain = Number(day.precipitation_sum_mm || 0);
    const tempMin = Number(day.temperature_min_c || 0);
    const tempMax = Number(day.temperature_max_c || 0);
    const wind = Number(day.wind_speed_10m_max_kmh || 0);

    const condition = day.condition || "Unknown";
    const icon = day.icon || "🌦️";
    const advice = day.advice || "Continue monitoring flood-prone areas.";

    return `
        <div class="forecast-calendar-cell ${severityClass}">
            <div class="forecast-card-top">
                <div>
                    <div class="forecast-date">${dateLabel}</div>
                    <div class="forecast-weekday">${weekday}</div>
                </div>
                <div class="forecast-icon">${icon}</div>
            </div>

            <div class="forecast-risk-pill ${levelClass}">
                ${probability}% · ${level}
            </div>

            <div class="forecast-detail-list">
                <p><strong>Condition:</strong> ${escapeForecastHtml(condition)}</p>
                <p><strong>Temp:</strong> ${tempMin.toFixed(1)}–${tempMax.toFixed(1)}°C</p>
                <p><strong>Rain:</strong> ${rain.toFixed(2)} mm</p>
                <p><strong>Wind:</strong> ${wind.toFixed(1)} km/h</p>
            </div>

            <div class="forecast-advice">
                ${escapeForecastHtml(advice)}
            </div>
        </div>
    `;
}

function parseForecastDate(dateText) {
    if (!dateText || String(dateText).startsWith("Demo")) return null;

    const parsed = new Date(`${dateText}T00:00:00`);

    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

function formatForecastDate(dateText) {
    const parsed = parseForecastDate(dateText);

    if (!parsed) {
        return dateText || "Demo Day";
    }

    return parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
}

function getCalendarSeverityClass(level) {
    const normalized = String(level).toLowerCase();

    if (normalized === "extreme") return "forecast-cell-extreme";
    if (normalized === "heavy") return "forecast-cell-heavy";
    if (normalized === "moderate") return "forecast-cell-moderate";
    if (normalized === "low") return "forecast-cell-low";

    return "forecast-cell-clear";
}