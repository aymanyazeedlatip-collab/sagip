const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:8000"
        : window.location.origin;

function switchTab(tabId) {
    document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.remove("active");
    });

    document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.classList.remove("active");
    });

    const selectedTab = document.getElementById(tabId);
    if (selectedTab) selectedTab.classList.add("active");

    const selectedButton = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
    if (selectedButton) selectedButton.classList.add("active");

    if (tabId === "area" && areaMap) {
        setTimeout(() => {
            areaMap.invalidateSize();
            updateBboxDisplay();
        }, 200);
    }
}

document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
        switchTab(button.dataset.tab);
    });
});

async function analyzeSelectedArea() {
    const bbox = getSelectedBbox();

    if (!bbox) {
        alert("No rectangle selected.");
        return;
    }

    const resolution = Number(document.getElementById("grid-resolution").value);

    const payload = {
        north: bbox.north,
        south: bbox.south,
        east: bbox.east,
        west: bbox.west,
        resolution: resolution,
    };

    const resultsBox = document.getElementById("area-results");
    resultsBox.classList.remove("hidden");
    resultsBox.innerHTML = `
    <div class="result-card">
      <span>Status</span>
      <strong>Analyzing...</strong>
    </div>
  `;

    try {
        const response = await fetch(`${API_BASE}/api/area/analyze`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Area analysis failed.");
        }

        renderAreaResults(data.area);

    } catch (error) {
        resultsBox.innerHTML = `
      <div class="result-card warning-card">
        <span>Error</span>
        <strong>Failed</strong>
        <p>${error.message}</p>
      </div>
    `;
    }
}

function renderAreaResults(area) {
    const resultsBox = document.getElementById("area-results");

    let warningHtml = "";

    if (area.warnings && area.warnings.length > 0) {
        warningHtml = `
      <div class="result-card warning-card">
        <span>Warnings</span>
        <strong>${area.warnings.length}</strong>
        <p>${area.warnings.join("<br>")}</p>
      </div>
    `;
    }

    resultsBox.innerHTML = `
    <div class="result-card">
      <span>Center Latitude</span>
      <strong>${area.center_lat}</strong>
    </div>

    <div class="result-card">
      <span>Center Longitude</span>
      <strong>${area.center_lng}</strong>
    </div>

    <div class="result-card">
      <span>Width</span>
      <strong>${area.width_km} km</strong>
    </div>

    <div class="result-card">
      <span>Height</span>
      <strong>${area.height_km} km</strong>
    </div>

    <div class="result-card">
      <span>Area</span>
      <strong>${area.area_km2} km²</strong>
    </div>

    <div class="result-card">
      <span>Grid Resolution</span>
      <strong>${area.resolution} × ${area.resolution}</strong>
    </div>

    <div class="result-card">
      <span>Total Cells</span>
      <strong>${area.cell_count}</strong>
    </div>

    ${warningHtml}
  `;
}

async function generateElevationGrid() {
    const bbox = getSelectedBbox();

    if (!bbox) {
        alert("No rectangle selected.");
        return;
    }

    const resolution = Number(document.getElementById("grid-resolution").value);

    const estimatedCells = resolution * resolution;

    if (estimatedCells > 6400) {
        alert("DEM grid is too large. Please use 80 × 80 or lower.");
        return;
    }

    if (estimatedCells > 2500) {
        const proceed = confirm(
            `You selected ${resolution} × ${resolution} = ${estimatedCells} elevation points.\n\n` +
            "This is high resolution and may take longer to generate.\n\n" +
            "Use this only for smaller areas like 1 km, 3 km, or 5 km scans.\n\n" +
            "Continue?"
        );

        if (!proceed) {
            return;
        }
    }

    const payload = {
        north: bbox.north,
        south: bbox.south,
        east: bbox.east,
        west: bbox.west,
        resolution: resolution,
    };

    const demBox = document.getElementById("dem-results");
    demBox.classList.remove("hidden");
    demBox.innerHTML = `
        <div class="result-card">
            <span>DEM Status</span>
            <strong>Generating...</strong>
            <p>Fetching 100% real DEM elevation data. Synthetic and interpolated terrain are disabled, so this may take longer.
        </div>
    `;

    try {
        const response = await fetch(`${API_BASE}/api/elevation-grid`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "DEM generation failed.");
        }

        window.latestTerrainData = data;
        renderDemResults(data);

    } catch (error) {
        demBox.innerHTML = `
            <div class="result-card warning-card">
                <span>DEM Error</span>
                <strong>Failed</strong>
                <p>${error.message}</p>
            </div>
        `;
    }
}

function renderDemResults(data) {
    const demBox = document.getElementById("dem-results");
    const summary = data.terrain.summary;

    let warningHtml = "";

    const warnings = [
        ...(data.area.warnings || []),
        ...(data.terrain.warnings || []),
    ];

    if (warnings.length > 0) {
        warningHtml = `
            <div class="result-card warning-card">
                <span>DEM Warnings</span>
                <strong>${warnings.length}</strong>
                <p>${warnings.join("<br>")}</p>
            </div>
        `;
    }

    demBox.innerHTML = `
        <div class="result-card">
            <span>Elevation Source</span>
            <strong>${data.terrain.source}</strong>
        </div>

        <div class="result-card">
            <span>Minimum Elevation</span>
            <strong>${summary.min_elevation_m} m</strong>
        </div>

        <div class="result-card">
            <span>Maximum Elevation</span>
            <strong>${summary.max_elevation_m} m</strong>
        </div>

        <div class="result-card">
            <span>Elevation Range</span>
            <strong>${summary.elevation_range_m} m</strong>
        </div>

        <div class="result-card">
            <span>Average Elevation</span>
            <strong>${summary.mean_elevation_m} m</strong>
        </div>

        <div class="result-card">
            <span>Average Slope</span>
            <strong>${summary.mean_slope_percent}%</strong>
        </div>

        <div class="result-card">
            <span>Low Points Detected</span>
            <strong>${summary.low_point_count}</strong>
        </div>

        <div class="result-card">
            <span>Terrain Type</span>
            <strong>${summary.terrain_type}</strong>
        </div>

${warningHtml}

<div class="result-card warning-card">
    <span>Next Step</span>
    <strong>3D Ready</strong>
    <p>The DEM grid is ready. You can now render this selected area as a 3D terrain surface.</p>
    <br>
    <button class="primary-btn" onclick="renderLatestTerrain3D()">Open 3D Terrain</button>
    <button class="secondary-btn" onclick="renderLatestHazardMap()">Open 2D Hazard Map</button>
    <button class="secondary-btn" onclick="fetchRainfallForecastForLatestArea()">Fetch 10-Day Rainfall</button>
    <button class="secondary-btn" onclick="runFloodSimulationForLatestData()">Run Flood Simulation</button>
</div>
`;
}