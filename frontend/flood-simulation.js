const SAGIP_FLOOD_API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:8000"
        : window.location.origin;

let latestFloodSimulation = null;
let currentFloodSnapshotIndex = 0;

let floodLocationMap = null;
let floodLocationRasterLayer = null;
let floodLocationRectangleLayer = null;
let floodLocationWaterLayer = null;
let floodLocationLowPointLayer = null;

async function runFloodSimulationForLatestData() {
    if (!window.latestTerrainData || !window.latestTerrainData.terrain) {
        alert("Please generate the DEM Terrain Grid first.");
        switchTab("area");
        return;
    }

    if (!window.latestRainfallForecast || !window.latestRainfallForecast.forecast) {
        const shouldFetch = confirm(
            "No rainfall forecast loaded yet.\n\nSAGIP needs rainfall data before simulation.\n\nFetch the 16-day rainfall forecast now?"
        );

        if (shouldFetch && typeof fetchRainfallForecastForLatestArea === "function") {
            await fetchRainfallForecastForLatestArea();
        } else {
            return;
        }
    }

    if (!window.latestRainfallForecast || !window.latestRainfallForecast.forecast) {
        alert("Rainfall forecast is still not available.");
        return;
    }

    switchTab("simulation");

    const runoffMultiplier = Number(document.getElementById("runoff-multiplier")?.value || 1.0);
    const snapshotInterval = Number(document.getElementById("snapshot-interval")?.value || 6);

    setFloodStatus("Running", "loading");

    const payload = {
        terrain: window.latestTerrainData.terrain,
        forecast: window.latestRainfallForecast.forecast,
        water_bodies: window.latestWaterBodies || [],
        snapshot_interval_hours: snapshotInterval,
        runoff_multiplier: runoffMultiplier,
    };

    try {
        const response = await fetch(`${SAGIP_FLOOD_API_BASE}/api/flood/simulate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Flood simulation failed.");
        }

        latestFloodSimulation = data.simulation;
        window.latestFloodSimulation = latestFloodSimulation;

        renderFloodSimulation(latestFloodSimulation);

        setFloodStatus("Complete", "success");

    } catch (error) {
        console.error("Flood simulation error:", error);
        setFloodStatus("Failed", "error");
        alert(`Flood simulation failed: ${error.message}`);
    }
}

function renderFloodSimulation(simulation) {
    const summary = simulation.summary;

    document.getElementById("flood-overall-level").textContent = summary.overall_level;
    document.getElementById("flood-peak-depth").textContent = `${summary.max_depth_cm} cm`;
    document.getElementById("flood-peak-time").textContent = summary.peak_time || "—";
    document.getElementById("flood-cell-count").textContent = summary.max_flooded_cells;

    const slider = document.getElementById("flood-timeline-slider");

    if (slider) {
        slider.min = 0;
        slider.max = Math.max(0, simulation.snapshots.length - 1);
        slider.step = 1;
        slider.value = 0;
    }

    const terrainSlider = document.getElementById("terrain-flood-timeline-slider");

    if (terrainSlider) {
        terrainSlider.min = 0;
        terrainSlider.max = Math.max(0, simulation.snapshots.length - 1);
        terrainSlider.step = 1;
        terrainSlider.value = 0;
    }

    updateTerrainTimelineReadout(0);

    initFloodLocationMap();
    drawFloodLocationStaticLayers();

    currentFloodSnapshotIndex = 0;
    showFloodSnapshotByIndex(0);
    initializeExperimentalMode();
}

function showFloodSnapshotByIndex(index) {
    if (!latestFloodSimulation || !latestFloodSimulation.snapshots) {
        return;
    }

    const snapshots = latestFloodSimulation.snapshots;

    if (!snapshots.length) return;

    index = Math.max(0, Math.min(snapshots.length - 1, index));
    currentFloodSnapshotIndex = index;
    updateTerrainTimelineReadout(index);

    const snapshot = snapshots[index];

    window.latestFloodSnapshot = snapshot;

    updateSnapshotText(snapshot);
    updateSnapshotWeatherText(snapshot);
    drawFloodDepthCanvas(snapshot);
    drawFloodLocationOverlay(snapshot);

    if (typeof renderFloodSnapshotOnTerrain === "function") {
        renderFloodSnapshotOnTerrain(snapshot);
    }
}

function updateSnapshotText(snapshot) {
    const time = document.getElementById("flood-current-time");
    const maxDepth = document.getElementById("snapshot-max-depth");
    const meanDepth = document.getElementById("snapshot-mean-depth");
    const floodedCells = document.getElementById("snapshot-flooded-cells");
    const highCells = document.getElementById("snapshot-high-cells");
    const readableDateTime = document.getElementById("flood-readable-datetime");

    const formattedTime = formatFloodDateTime(snapshot.time);

    if (time) time.textContent = `Simulation Hour ${snapshot.hour_index}`;
    if (readableDateTime) readableDateTime.textContent = formattedTime;

    if (maxDepth) maxDepth.textContent = `${snapshot.max_depth_cm} cm`;
    if (meanDepth) meanDepth.textContent = `${snapshot.mean_depth_cm} cm`;
    if (floodedCells) floodedCells.textContent = snapshot.flooded_cell_count;
    if (highCells) highCells.textContent = snapshot.high_or_severe_cell_count;
}

function drawFloodDepthCanvas(snapshot) {
    const canvas = document.getElementById("flood-depth-canvas");

    if (!canvas) return;

    const depthGrid = snapshot.depth_grid_cm;
    const classGrid = snapshot.class_grid;

    if (!depthGrid || !classGrid) return;

    const rows = depthGrid.length;
    const cols = depthGrid[0].length;

    const size = Math.min(canvas.clientWidth || 720, 720);

    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#f8fbff";
    ctx.fillRect(0, 0, size, size);

    const cellW = size / cols;
    const cellH = size / rows;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const level = classGrid[r][c];
            const depth = depthGrid[r][c];

            ctx.fillStyle = getFloodCanvasColor(level, depth);
            ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
        }
    }

    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, size - 4, size - 4);

    ctx.fillStyle = "#0f172a";
    ctx.font = "13px Outfit, sans-serif";
    ctx.fillText(`Simulated flood depth · ${snapshot.time}`, 14, 24);
}

function getFloodCanvasColor(level, depth) {
    if (level === "severe") return "rgba(30, 64, 175, 0.92)";
    if (level === "high") return "rgba(37, 99, 235, 0.82)";
    if (level === "moderate") return "rgba(14, 165, 233, 0.68)";
    if (level === "low") return "rgba(125, 211, 252, 0.55)";

    return "rgba(226, 232, 240, 0.35)";
}

function setFloodStatus(text, type) {
    const status = document.getElementById("flood-status");

    if (!status) return;

    status.textContent = text;
    status.className = `flood-badge ${type || ""}`;
}

function updateSnapshotWeatherText(snapshot) {
    const rainfallEl = document.getElementById("flood-current-rainfall");
    const probabilityEl = document.getElementById("flood-current-probability");
    const conditionEl = document.getElementById("flood-current-condition");

    const weather = getWeatherForSimulationHour(snapshot.hour_index);

    if (!weather) {
        if (rainfallEl) rainfallEl.textContent = "—";
        if (probabilityEl) probabilityEl.textContent = "—";
        if (conditionEl) conditionEl.textContent = "—";
        return;
    }

    const rainfall = Number(weather.precipitation_mm ?? weather.rain_mm ?? 0);
    const probability = Number(weather.precipitation_probability_percent ?? 0);

    if (rainfallEl) rainfallEl.textContent = `${rainfall.toFixed(2)} mm`;
    if (probabilityEl) probabilityEl.textContent = `${probability}%`;
    if (conditionEl) conditionEl.textContent = inferHourlyCondition(weather, rainfall);
}

function getWeatherForSimulationHour(hourIndex) {
    const hourly = window.latestRainfallForecast?.forecast?.hourly || [];

    if (!hourly.length) return null;

    return hourly[Math.max(0, Math.min(hourly.length - 1, hourIndex))];
}

function inferHourlyCondition(hour, rainfall) {
    if (rainfall >= 7.5) return "Intense rainfall";
    if (rainfall >= 2.5) return "Heavy rain";
    if (rainfall >= 0.5) return "Rain";
    if (rainfall > 0) return "Light rain";

    const humidity = Number(hour.relative_humidity_2m_percent ?? 0);

    if (humidity >= 90) return "Humid / cloudy";
    return "No significant rain";
}

function formatFloodDateTime(rawTime) {
    if (!rawTime) return "—";

    const parsed = new Date(rawTime);

    if (Number.isNaN(parsed.getTime())) {
        return rawTime;
    }

    return parsed.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function initFloodLocationMap() {
    const mapElement = document.getElementById("flood-location-map");

    if (!mapElement) return;

    if (!floodLocationMap) {
        floodLocationMap = L.map("flood-location-map", {
            zoomControl: true,
            attributionControl: true,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors",
        }).addTo(floodLocationMap);
    }

    setTimeout(() => {
        floodLocationMap.invalidateSize();
        fitFloodLocationMapToArea();
    }, 200);
}

function drawFloodLocationStaticLayers() {
    if (!floodLocationMap || !window.latestTerrainData) return;

    clearFloodLocationStaticLayers();

    const bbox = getFloodBbox();

    const bounds = [
        [bbox.south, bbox.west],
        [bbox.north, bbox.east],
    ];

    floodLocationRectangleLayer = L.rectangle(bounds, {
        color: "#0284c7",
        weight: 3,
        fillColor: "transparent",
    }).addTo(floodLocationMap);

    drawFloodLocationWaterBodies();
    drawFloodLocationLowPoints();
    fitFloodLocationMapToArea();
}

function clearFloodLocationStaticLayers() {
    if (!floodLocationMap) return;

    if (floodLocationRectangleLayer) {
        floodLocationMap.removeLayer(floodLocationRectangleLayer);
        floodLocationRectangleLayer = null;
    }

    if (floodLocationWaterLayer) {
        floodLocationMap.removeLayer(floodLocationWaterLayer);
        floodLocationWaterLayer = null;
    }

    if (floodLocationLowPointLayer) {
        floodLocationMap.removeLayer(floodLocationLowPointLayer);
        floodLocationLowPointLayer = null;
    }
}

function drawFloodLocationOverlay(snapshot) {
    if (!floodLocationMap || !window.latestTerrainData || !snapshot) return;

    if (floodLocationRasterLayer) {
        floodLocationMap.removeLayer(floodLocationRasterLayer);
        floodLocationRasterLayer = null;
    }

    const bbox = getFloodBbox();

    const depthGrid = snapshot.depth_grid_cm;
    const classGrid = snapshot.class_grid;

    if (!depthGrid || !classGrid) return;

    const rows = depthGrid.length;
    const cols = depthGrid[0].length;

    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;

    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(cols, rows);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const index = (r * cols + c) * 4;
            const color = getFloodMapColor(classGrid[r][c], depthGrid[r][c]);

            image.data[index] = color.r;
            image.data[index + 1] = color.g;
            image.data[index + 2] = color.b;
            image.data[index + 3] = color.a;
        }
    }

    ctx.putImageData(image, 0, 0);

    const imageUrl = canvas.toDataURL("image/png");

    const bounds = [
        [bbox.south, bbox.west],
        [bbox.north, bbox.east],
    ];

    floodLocationRasterLayer = L.imageOverlay(imageUrl, bounds, {
        opacity: 0.65,
        interactive: false,
    }).addTo(floodLocationMap);

    if (floodLocationRectangleLayer && typeof floodLocationRectangleLayer.bringToFront === "function") {
        floodLocationRectangleLayer.bringToFront();
    }

    bringLayerGroupToFront(floodLocationWaterLayer);
    bringLayerGroupToFront(floodLocationLowPointLayer);
}

function getFloodMapColor(level, depth) {
    if (level === "severe") return { r: 30, g: 64, b: 175, a: 215 };
    if (level === "high") return { r: 37, g: 99, b: 235, a: 195 };
    if (level === "moderate") return { r: 14, g: 165, b: 233, a: 165 };
    if (level === "low") return { r: 125, g: 211, b: 252, a: 135 };

    return { r: 255, g: 255, b: 255, a: 0 };
}

function drawFloodLocationWaterBodies() {
    const waterBodies = window.latestWaterBodies || [];

    floodLocationWaterLayer = L.layerGroup();

    waterBodies.forEach((feature) => {
        const geometries = feature.geometries || [];
        const importance = Number(feature.overflow_importance || 0.5);

        geometries.forEach((geometry) => {
            const latlngs = geometry.map((point) => [point.lat, point.lon]);

            if (latlngs.length < 2) return;

            const line = L.polyline(latlngs, {
                color: importance >= 0.85 ? "#1e40af" : "#0284c7",
                weight: Math.max(2, Math.min(7, importance * 7)),
                opacity: 0.9,
            });

            line.bindPopup(`
                <div class="flood-map-popup">
                    <strong>${escapeFloodHtml(feature.name || "Water feature")}</strong><br>
                    Type: ${escapeFloodHtml(feature.category || "Water")}<br>
                    Flood role: ${escapeFloodHtml(feature.flood_role || "May affect local flood behavior")}
                </div>
            `);

            floodLocationWaterLayer.addLayer(line);
        });
    });

    floodLocationWaterLayer.addTo(floodLocationMap);
}

function drawFloodLocationLowPoints() {
    const terrain = window.latestTerrainData?.terrain;
    if (!terrain) return;

    const lowPoints = terrain.low_points || [];
    const latitudes = terrain.latitudes || [];
    const longitudes = terrain.longitudes || [];

    floodLocationLowPointLayer = L.layerGroup();

    lowPoints.slice(0, 80).forEach((point) => {
        const lat = latitudes[point.row];
        const lng = longitudes[point.col];

        if (lat === undefined || lng === undefined) return;

        const marker = L.circleMarker([lat, lng], {
            radius: 4,
            color: "#b91c1c",
            weight: 2,
            fillColor: "#ef4444",
            fillOpacity: 0.9,
        });

        marker.bindPopup(`
            <div class="flood-map-popup">
                <strong>Detected low point</strong><br>
                Elevation: ${point.elevation} m<br>
                Possible flood pooling zone
            </div>
        `);

        floodLocationLowPointLayer.addLayer(marker);
    });

    floodLocationLowPointLayer.addTo(floodLocationMap);
}

function fitFloodLocationMapToArea() {
    if (!floodLocationMap || !window.latestTerrainData) return;

    const bbox = getFloodBbox();

    const bounds = [
        [bbox.south, bbox.west],
        [bbox.north, bbox.east],
    ];

    floodLocationMap.fitBounds(bounds, {
        padding: [30, 30],
        maxZoom: 16,
    });

    setTimeout(() => {
        floodLocationMap.invalidateSize();
    }, 150);
}

function getFloodBbox() {
    const terrain = window.latestTerrainData.terrain;

    const latitudes = terrain.latitudes;
    const longitudes = terrain.longitudes;

    return {
        north: Math.max(...latitudes),
        south: Math.min(...latitudes),
        east: Math.max(...longitudes),
        west: Math.min(...longitudes),
    };
}

function escapeFloodHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function bringLayerGroupToFront(layerGroup) {
    if (!layerGroup) return;

    if (typeof layerGroup.eachLayer !== "function") return;

    layerGroup.eachLayer((layer) => {
        if (layer && typeof layer.bringToFront === "function") {
            layer.bringToFront();
        }
    });
}

function updateTerrainTimelineReadout(index) {
    const terrainSlider = document.getElementById("terrain-flood-timeline-slider");
    const terrainLabel = document.getElementById("terrain-flood-timeline-label");

    const simulation = window.latestFloodSimulation || latestFloodSimulation;

    if (terrainSlider && simulation?.snapshots?.length) {
        terrainSlider.min = 0;
        terrainSlider.max = Math.max(0, simulation.snapshots.length - 1);
        terrainSlider.step = 1;
        terrainSlider.value = index;
    }

    if (terrainLabel) {
        const snapshot = simulation?.snapshots?.[index];

        if (snapshot) {
            terrainLabel.textContent = `Showing 3D flood snapshot ${index + 1} of ${simulation.snapshots.length} · Hour ${snapshot.hour_index ?? 0}`;
        } else {
            terrainLabel.textContent = "Run Flood Simulation first, then drag this slider while viewing the 3D terrain.";
        }
    }
}

function initializeExperimentalMode() {
    const slider = document.getElementById("experimental-water-level");

    if (!slider) return;

    slider.value = 0;
    slider.min = 0;
    slider.max = 100;
    slider.step = 1;
    updateExperimentalWaterLevel(0);
}

function updateExperimentalWaterLevel(levelPercent) {
    levelPercent = Number(levelPercent || 0);

    const label = document.getElementById("experimental-water-level-label");
    const readout = document.getElementById("experimental-level-readout");

    if (label) label.textContent = `${levelPercent}%`;

    if (!window.latestTerrainData || !window.latestTerrainData.terrain) {
        if (readout) readout.textContent = `${levelPercent}% terrain flood level`;
        drawExperimentalEmptyCanvas("Generate DEM terrain first.");
        return;
    }

    const terrain = window.latestTerrainData.terrain;
    const minElevation = Number(terrain.summary.min_elevation_m || 0);
    const maxElevation = Number(terrain.summary.max_elevation_m || minElevation + 1);
    const elevationRange = Math.max(1, maxElevation - minElevation);
    const waterSurfaceElevation = minElevation + elevationRange * (levelPercent / 100);

    if (readout) {
        readout.textContent = `${levelPercent}% of terrain height range · water surface ≈ ${waterSurfaceElevation.toFixed(2)} m elevation`;
    }

    const snapshot = buildExperimentalWaterSnapshot(levelPercent);

    drawExperimentalFloodCanvas(snapshot);
    updateExperimentalStats(snapshot);

    const applyToMainMaps = document.getElementById("experimental-apply-main-maps")?.checked;

    if (applyToMainMaps) {
        window.latestFloodSnapshot = snapshot;

        drawFloodDepthCanvas(snapshot);

        if (typeof drawFloodLocationOverlay === "function") {
            drawFloodLocationOverlay(snapshot);
        }

        if (typeof renderFloodSnapshotOnTerrain === "function") {
            renderFloodSnapshotOnTerrain(snapshot);
        }
    }
}

function buildExperimentalWaterSnapshot(levelPercent) {
    levelPercent = Number(levelPercent || 0);

    const terrain = window.latestTerrainData.terrain;
    const elevationGrid = terrain.elevation_grid;

    const rows = elevationGrid.length;
    const cols = elevationGrid[0].length;

    const minElevation = Number(terrain.summary.min_elevation_m || 0);
    const maxElevation = Number(terrain.summary.max_elevation_m || minElevation + 1);
    const elevationRange = Math.max(1, maxElevation - minElevation);

    /*
      Old behavior used centimeters above the absolute lowest DEM point.
      In mountain terrain with a 700m+ elevation range, 290 cm only floods tiny low pockets.

      New behavior uses a terrain-relative flood level:
      0% = lowest DEM elevation
      100% = highest DEM elevation
      This makes the manual experiment behave like a broad rising water scenario.
    */
    const waterSurfaceElevation = minElevation + elevationRange * (levelPercent / 100);

    const depthGrid = [];
    const classGrid = [];

    let maxDepth = 0;
    let totalDepth = 0;
    let floodedCells = 0;
    let highOrSevere = 0;

    const counts = {
        none: 0,
        low: 0,
        moderate: 0,
        high: 0,
        severe: 0,
    };

    for (let r = 0; r < rows; r++) {
        const depthRow = [];
        const classRow = [];

        for (let c = 0; c < cols; c++) {
            const elevation = Number(elevationGrid[r][c]);
            const rawDepthCm = Math.max(0, (waterSurfaceElevation - elevation) * 100);

            // Visual/experimental cap so the 2D and 3D overlays remain readable.
            const roundedDepth = Math.round(Math.min(500, rawDepthCm) * 100) / 100;

            const level = classifyExperimentalDepth(roundedDepth);

            depthRow.push(roundedDepth);
            classRow.push(level);

            counts[level] += 1;

            if (roundedDepth >= 1) {
                floodedCells += 1;
                totalDepth += roundedDepth;
            }

            if (level === "high" || level === "severe") {
                highOrSevere += 1;
            }

            maxDepth = Math.max(maxDepth, roundedDepth);
        }

        depthGrid.push(depthRow);
        classGrid.push(classRow);
    }

    const meanDepth = floodedCells > 0 ? totalDepth / floodedCells : 0;

    return {
        hour_index: 0,
        time: `Experimental terrain flood level: ${levelPercent}%`,
        max_depth_cm: Math.round(maxDepth * 100) / 100,
        mean_depth_cm: Math.round(meanDepth * 100) / 100,
        flooded_cell_count: floodedCells,
        high_or_severe_cell_count: highOrSevere,
        counts: counts,
        depth_grid_cm: depthGrid,
        class_grid: classGrid,
        experimental_level_percent: levelPercent,
        experimental_water_surface_elevation_m: Math.round(waterSurfaceElevation * 100) / 100,
    };
}

function classifyExperimentalDepth(depthCm) {
    if (depthCm < 1) return "none";
    if (depthCm < 5) return "low";
    if (depthCm < 15) return "moderate";
    if (depthCm < 40) return "high";
    return "severe";
}

function drawExperimentalFloodCanvas(snapshot) {
    const canvas = document.getElementById("experimental-flood-canvas");

    if (!canvas) return;

    const depthGrid = snapshot.depth_grid_cm;
    const classGrid = snapshot.class_grid;

    const rows = depthGrid.length;
    const cols = depthGrid[0].length;

    const size = Math.min(canvas.clientWidth || 720, 720);

    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#f8fbff";
    ctx.fillRect(0, 0, size, size);

    const cellW = size / cols;
    const cellH = size / rows;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const level = classGrid[r][c];
            const depth = depthGrid[r][c];

            ctx.fillStyle = getFloodCanvasColor(level, depth);
            ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
        }
    }

    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, size - 4, size - 4);

    ctx.fillStyle = "#0f172a";
    ctx.font = "13px Outfit, sans-serif";
    ctx.fillText(`Experimental terrain flood level: ${snapshot.experimental_level_percent ?? 0}%`, 14, 24);
}

function updateExperimentalStats(snapshot) {
    const floodedCells = document.getElementById("experimental-flooded-cells");
    const maxDepth = document.getElementById("experimental-max-depth");
    const areaShare = document.getElementById("experimental-area-share");

    const rows = snapshot.depth_grid_cm.length;
    const cols = snapshot.depth_grid_cm[0].length;
    const totalCells = rows * cols;

    const share = totalCells > 0
        ? Math.round((snapshot.flooded_cell_count / totalCells) * 100)
        : 0;

    if (floodedCells) floodedCells.textContent = snapshot.flooded_cell_count;
    if (maxDepth) maxDepth.textContent = `${snapshot.max_depth_cm} cm`;
    if (areaShare) areaShare.textContent = `${share}%`;
}

function drawExperimentalEmptyCanvas(message) {
    const canvas = document.getElementById("experimental-flood-canvas");

    if (!canvas) return;

    const size = Math.min(canvas.clientWidth || 720, 720);

    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f8fbff";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "#dbeafe";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 10; i++) {
        const p = (i / 10) * size;

        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
    }

    ctx.fillStyle = "#64748b";
    ctx.font = "14px Outfit, sans-serif";
    ctx.fillText(message, 16, 28);
}