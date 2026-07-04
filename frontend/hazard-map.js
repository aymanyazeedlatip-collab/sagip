let hazardMap = null;
let hazardRectangle = null;
let hazardRasterLayer = null;
let hazardLowPointLayer = null;
let hazardWaterLayer = null;
let latestHazardData = null;

function renderLatestHazardMap() {
    if (!window.latestTerrainData) {
        alert("Please generate the DEM Terrain Grid first in the Area Selection tab.");
        switchTab("area");
        return;
    }

    switchTab("hazard");

    setTimeout(() => {
        initHazardMap();
        buildHazardPreview(window.latestTerrainData);
    }, 250);
}

function initHazardMap() {
    const mapElement = document.getElementById("hazard-leaflet-map");

    if (!mapElement) {
        alert("Hazard map container was not found.");
        return;
    }

    if (!hazardMap) {
        hazardMap = L.map("hazard-leaflet-map", {
            zoomControl: true,
            attributionControl: true,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors",
        }).addTo(hazardMap);
    }

    setTimeout(() => {
        hazardMap.invalidateSize();
    }, 150);
}

function buildHazardPreview(terrainData) {
    setHazardStatus("Building DEM-based hazard preview...");

    clearHazardLayers();

    const hazard = computeHazardGrid(terrainData);
    latestHazardData = hazard;

    drawHazardRaster(terrainData, hazard);
    drawHazardLowPoints(terrainData);
    drawHazardWaterBodies();
    drawHazardRectangle(terrainData);
    updateHazardSummary(hazard);

    fitHazardMapToArea();

    setHazardStatus("DEM-based hazard preview rendered successfully.");
}

function clearHazardLayers() {
    if (!hazardMap) return;

    if (hazardRasterLayer) {
        hazardMap.removeLayer(hazardRasterLayer);
        hazardRasterLayer = null;
    }

    if (hazardLowPointLayer) {
        hazardMap.removeLayer(hazardLowPointLayer);
        hazardLowPointLayer = null;
    }

    if (hazardWaterLayer) {
        hazardMap.removeLayer(hazardWaterLayer);
        hazardWaterLayer = null;
    }

    if (hazardRectangle) {
        hazardMap.removeLayer(hazardRectangle);
        hazardRectangle = null;
    }
}

function computeHazardGrid(terrainData) {
    const elevationGrid = terrainData.terrain.elevation_grid;
    const slopeGrid = terrainData.terrain.slope_grid;
    const lowPoints = terrainData.terrain.low_points || [];
    const summary = terrainData.terrain.summary;

    const rows = elevationGrid.length;
    const cols = elevationGrid[0].length;

    const minElev = summary.min_elevation_m;
    const maxElev = summary.max_elevation_m;
    const elevRange = Math.max(maxElev - minElev, 1);

    const lowPointSet = new Set(
        lowPoints.map((point) => `${point.row},${point.col}`)
    );

    const waterInfluenceGrid = buildWaterInfluenceGrid(terrainData);

    const scores = [];
    const classes = [];

    const counts = {
        low: 0,
        moderate: 0,
        high: 0,
        severe: 0,
    };

    let maxScore = 0;

    for (let r = 0; r < rows; r++) {
        const scoreRow = [];
        const classRow = [];

        for (let c = 0; c < cols; c++) {
            const elevation = elevationGrid[r][c];
            const slope = slopeGrid[r][c];

            const normalizedElevation = (elevation - minElev) / elevRange;

            const lowElevationRisk = 1 - normalizedElevation;
            const flatnessRisk = 1 - Math.min(slope / 12, 1);
            const lowPointRisk = lowPointSet.has(`${r},${c}`) ? 1 : nearbyLowPointRisk(r, c, lowPoints);
            const waterRisk = waterInfluenceGrid[r][c];

            let score =
                lowElevationRisk * 45 +
                flatnessRisk * 20 +
                lowPointRisk * 25 +
                waterRisk * 10;

            score = Math.max(0, Math.min(100, score));

            const hazardClass = classifyHazardScore(score);

            counts[hazardClass] += 1;
            maxScore = Math.max(maxScore, score);

            scoreRow.push(roundNumber(score, 2));
            classRow.push(hazardClass);
        }

        scores.push(scoreRow);
        classes.push(classRow);
    }

    return {
        scores,
        classes,
        counts,
        maxScore: roundNumber(maxScore, 2),
    };
}

function nearbyLowPointRisk(row, col, lowPoints) {
    if (!lowPoints || lowPoints.length === 0) return 0;

    let nearestDistance = Infinity;

    lowPoints.slice(0, 120).forEach((point) => {
        const dr = point.row - row;
        const dc = point.col - col;
        const distance = Math.sqrt(dr * dr + dc * dc);

        nearestDistance = Math.min(nearestDistance, distance);
    });

    if (nearestDistance <= 1) return 0.8;
    if (nearestDistance <= 2) return 0.55;
    if (nearestDistance <= 4) return 0.3;

    return 0;
}

function buildWaterInfluenceGrid(terrainData) {
    const elevationGrid = terrainData.terrain.elevation_grid;
    const rows = elevationGrid.length;
    const cols = elevationGrid[0].length;

    const grid = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => 0)
    );

    const waterBodies = window.latestWaterBodies || [];

    if (!waterBodies.length) {
        return grid;
    }

    const bbox = getHazardBbox(terrainData);

    waterBodies.forEach((feature) => {
        const importance = Number(feature.overflow_importance || 0.5);
        const geometries = feature.geometries || [];

        geometries.forEach((geometry) => {
            geometry.forEach((point) => {
                const row = Math.round(((bbox.north - point.lat) / (bbox.north - bbox.south)) * (rows - 1));
                const col = Math.round(((point.lon - bbox.west) / (bbox.east - bbox.west)) * (cols - 1));

                applyWaterInfluence(grid, row, col, importance);
            });
        });
    });

    return grid;
}

function applyWaterInfluence(grid, centerRow, centerCol, importance) {
    const rows = grid.length;
    const cols = grid[0].length;

    for (let dr = -3; dr <= 3; dr++) {
        for (let dc = -3; dc <= 3; dc++) {
            const r = centerRow + dr;
            const c = centerCol + dc;

            if (r < 0 || r >= rows || c < 0 || c >= cols) continue;

            const distance = Math.sqrt(dr * dr + dc * dc);
            const influence = Math.max(0, 1 - distance / 4) * importance;

            grid[r][c] = Math.max(grid[r][c], influence);
        }
    }
}

function classifyHazardScore(score) {
    if (score >= 75) return "severe";
    if (score >= 55) return "high";
    if (score >= 35) return "moderate";
    return "low";
}

function drawHazardRaster(terrainData, hazard) {
    const bbox = getHazardBbox(terrainData);
    const classes = hazard.classes;
    const scores = hazard.scores;

    const rows = classes.length;
    const cols = classes[0].length;

    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;

    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(cols, rows);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const index = (r * cols + c) * 4;
            const color = getHazardColor(classes[r][c], scores[r][c]);

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

    hazardRasterLayer = L.imageOverlay(imageUrl, bounds, {
        opacity: 0.62,
        interactive: true,
    }).addTo(hazardMap);
}

function getHazardColor(hazardClass, score) {
    if (hazardClass === "severe") {
        return { r: 239, g: 68, b: 68, a: 215 };
    }

    if (hazardClass === "high") {
        return { r: 249, g: 115, b: 22, a: 205 };
    }

    if (hazardClass === "moderate") {
        return { r: 250, g: 204, b: 21, a: 190 };
    }

    return { r: 34, g: 197, b: 94, a: 120 };
}

function drawHazardLowPoints(terrainData) {
    const lowPoints = terrainData.terrain.low_points || [];
    const latitudes = terrainData.terrain.latitudes;
    const longitudes = terrainData.terrain.longitudes;

    hazardLowPointLayer = L.layerGroup();

    lowPoints.slice(0, 80).forEach((point) => {
        const lat = latitudes[point.row];
        const lng = longitudes[point.col];

        const marker = L.circleMarker([lat, lng], {
            radius: 5,
            color: "#b91c1c",
            weight: 2,
            fillColor: "#ef4444",
            fillOpacity: 0.9,
        });

        marker.bindPopup(`
            <div class="hazard-cell-popup">
                <strong>Detected low point</strong><br>
                Elevation: ${point.elevation} m<br>
                Potential local pooling zone
            </div>
        `);

        hazardLowPointLayer.addLayer(marker);
    });

    hazardLowPointLayer.addTo(hazardMap);
}

function drawHazardWaterBodies() {
    const waterBodies = window.latestWaterBodies || [];

    hazardWaterLayer = L.layerGroup();

    waterBodies.forEach((feature) => {
        const geometries = feature.geometries || [];
        const importance = Number(feature.overflow_importance || 0.5);

        geometries.forEach((geometry) => {
            const latlngs = geometry.map((point) => [point.lat, point.lon]);

            if (latlngs.length < 2) return;

            const line = L.polyline(latlngs, {
                color: getHazardWaterColor(importance),
                weight: Math.max(2, Math.min(7, importance * 7)),
                opacity: 0.85,
            });

            line.bindPopup(`
                <div class="hazard-cell-popup">
                    <strong>${escapeHazardHtml(feature.name || "Water feature")}</strong><br>
                    Type: ${escapeHazardHtml(feature.category || "Water")}<br>
                    Flood role: ${escapeHazardHtml(feature.flood_role || "May affect local flood behavior")}
                </div>
            `);

            hazardWaterLayer.addLayer(line);
        });
    });

    hazardWaterLayer.addTo(hazardMap);
}

function getHazardWaterColor(importance) {
    if (importance >= 0.85) return "#1e40af";
    if (importance >= 0.65) return "#2563eb";
    if (importance >= 0.5) return "#0284c7";
    return "#7dd3fc";
}

function drawHazardRectangle(terrainData) {
    const bbox = getHazardBbox(terrainData);

    const bounds = [
        [bbox.south, bbox.west],
        [bbox.north, bbox.east],
    ];

    hazardRectangle = L.rectangle(bounds, {
        color: "#0284c7",
        weight: 3,
        fillColor: "transparent",
    }).addTo(hazardMap);
}

function fitHazardMapToArea() {
    if (!hazardMap || !window.latestTerrainData) return;

    const bbox = getHazardBbox(window.latestTerrainData);

    const bounds = [
        [bbox.south, bbox.west],
        [bbox.north, bbox.east],
    ];

    hazardMap.fitBounds(bounds, {
        padding: [30, 30],
        maxZoom: 16,
    });

    setTimeout(() => {
        hazardMap.invalidateSize();
    }, 150);
}

function updateHazardSummary(hazard) {
    const low = document.getElementById("hazard-low-count");
    const moderate = document.getElementById("hazard-moderate-count");
    const high = document.getElementById("hazard-high-count");
    const severe = document.getElementById("hazard-severe-count");
    const maxScore = document.getElementById("hazard-max-score");
    const interpretation = document.getElementById("hazard-interpretation");

    if (low) low.textContent = hazard.counts.low;
    if (moderate) moderate.textContent = hazard.counts.moderate;
    if (high) high.textContent = hazard.counts.high;
    if (severe) severe.textContent = hazard.counts.severe;
    if (maxScore) maxScore.textContent = `${hazard.maxScore} / 100`;

    if (interpretation) {
        interpretation.textContent = buildHazardInterpretation(hazard);
    }
}

function buildHazardInterpretation(hazard) {
    const total =
        hazard.counts.low +
        hazard.counts.moderate +
        hazard.counts.high +
        hazard.counts.severe;

    const risky = hazard.counts.high + hazard.counts.severe;
    const riskyPercent = total > 0 ? Math.round((risky / total) * 100) : 0;

    if (riskyPercent >= 40) {
        return `${riskyPercent}% of the scanned cells are classified as high or severe susceptibility. This area should be prioritized for rainfall-based flood simulation and vulnerability checking.`;
    }

    if (riskyPercent >= 20) {
        return `${riskyPercent}% of the scanned cells are high or severe. Monitor low-lying zones, water-adjacent areas, and detected depressions.`;
    }

    if (riskyPercent > 0) {
        return `${riskyPercent}% of the scanned cells are high or severe. Risk appears localized, mostly around lower or flatter terrain.`;
    }

    return "No high or severe terrain-based susceptibility zones were detected in this preview.";
}

function getHazardBbox(terrainData) {
    const latitudes = terrainData.terrain.latitudes;
    const longitudes = terrainData.terrain.longitudes;

    return {
        north: Math.max(...latitudes),
        south: Math.min(...latitudes),
        east: Math.max(...longitudes),
        west: Math.min(...longitudes),
    };
}

function setHazardStatus(message) {
    const status = document.getElementById("hazard-map-status");

    if (status) {
        status.textContent = message;
    }
}

function roundNumber(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

function escapeHazardHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}