const SAGIP_FULL_API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:8000"
        : window.location.origin;

async function runFullSagipAnalysis() {
    const bbox = getSelectedBbox();

    if (!bbox) {
        alert("Please select an area first.");
        switchTab("area");
        return;
    }

    const resolution = Number(document.getElementById("grid-resolution")?.value || 80);
    const estimatedCells = resolution * resolution;

    if (estimatedCells > 2500) {
        const proceed = confirm(
            `You selected ${resolution} × ${resolution} = ${estimatedCells} DEM cells.\n\n` +
            "This gives more detailed terrain but may take longer.\n\n" +
            "Continue with full SAGIP analysis?"
        );

        if (!proceed) return;
    }

    showSagipFullLoader();

    try {
        updateSagipFullLoader(
            8,
            "Validating selected area...",
            "Checking rectangle boundaries and preparing the analysis request."
        );

        const areaPayload = {
            north: bbox.north,
            south: bbox.south,
            east: bbox.east,
            west: bbox.west,
            resolution: resolution,
        };

        updateSagipFullLoader(
            18,
            "Generating DEM terrain grid...",
            "Fetching 100% real DEM elevation data. No synthetic or interpolated terrain will be used. This may take longer."
        );

        const terrainResponse = await postSagipFullJson("/api/elevation-grid", areaPayload);
        window.latestTerrainData = terrainResponse;

        updateSagipFullLoader(
            38,
            "Fetching 16-day rainfall forecast...",
            "Requesting hourly and daily rainfall data for the selected area."
        );

        const forecastResponse = await postSagipFullJson("/api/weather/forecast", {
            north: bbox.north,
            south: bbox.south,
            east: bbox.east,
            west: bbox.west,
            forecast_days: 16,
        });

        window.latestRainfallForecast = forecastResponse;

        updateSagipFullLoader(
            56,
            "Scanning mapped water bodies...",
            "Detecting rivers, streams, canals, drains, lakes, ponds, reservoirs, and basins."
        );

        let waterBodies = [];
        let waterSummary = null;

        try {
            const waterResponse = await postSagipFullJson("/api/water-bodies", {
                north: bbox.north,
                south: bbox.south,
                east: bbox.east,
                west: bbox.west,
            });

            waterBodies = waterResponse.water?.water_bodies || [];
            waterSummary = waterResponse.water?.summary || null;

        } catch (waterError) {
            console.warn("Water body scan failed but full workflow will continue:", waterError);
            waterBodies = [];
            waterSummary = {
                total_count: 0,
                river_count: 0,
                stream_count: 0,
                drainage_count: 0,
                storage_count: 0,
            };
        }

        window.latestWaterBodies = waterBodies;
        window.latestWaterSummary = waterSummary;

        updateSagipFullLoader(
            74,
            "Running flood accumulation simulation...",
            "Combining DEM, low points, water bodies, and 16-day hourly rainfall."
        );

        const runoffMultiplier = Number(document.getElementById("runoff-multiplier")?.value || 1.0);
        const snapshotInterval = Number(document.getElementById("snapshot-interval")?.value || 6);

        const floodResponse = await postSagipFullJson("/api/flood/simulate", {
            terrain: terrainResponse.terrain,
            forecast: forecastResponse.forecast,
            water_bodies: waterBodies,
            snapshot_interval_hours: snapshotInterval,
            runoff_multiplier: runoffMultiplier,
        });

        window.latestFloodSimulation = floodResponse.simulation;
        latestFloodSimulation = floodResponse.simulation;

        updateSagipFullLoader(
            92,
            "Preparing visual results...",
            "Rendering terrain, rainfall, water body, and flood simulation modules."
        );

        renderAllSagipResultsAfterFullRun();

        updateSagipFullLoader(
            100,
            "SAGIP analysis complete.",
            "All modules finished. Opening the Flood Simulation dashboard."
        );

        setTimeout(() => {
            hideSagipFullLoader();
        }, 900);

    } catch (error) {
        console.error("Full SAGIP analysis failed:", error);

        updateSagipFullLoader(
            100,
            "Full analysis failed.",
            error.message || "An unknown error occurred."
        );

        setTimeout(() => {
            hideSagipFullLoader();
            alert(`Full SAGIP analysis failed: ${error.message}`);
        }, 900);
    }
}

async function postSagipFullJson(endpoint, payload) {
    const response = await fetch(`${SAGIP_FULL_API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.detail || `${endpoint} failed.`);
    }

    return data;
}

function renderAllSagipResultsAfterFullRun() {
    if (typeof renderDemResults === "function" && window.latestTerrainData?.terrain) {
        renderDemResults(window.latestTerrainData);
    }

    switchTab("simulation");

    if (typeof renderRainfallForecast === "function" && window.latestRainfallForecast?.forecast) {
        renderRainfallForecast(window.latestRainfallForecast);
    }

    if (typeof renderLatestTerrain3D === "function" && window.latestTerrainData?.terrain) {
        renderLatestTerrain3D();
    }

    if (typeof renderFloodSimulation === "function" && window.latestFloodSimulation) {
        renderFloodSimulation(window.latestFloodSimulation);
    }

    if (typeof initializeExperimentalMode === "function") {
        initializeExperimentalMode();
    }
}

function showSagipFullLoader() {
    const loader = document.getElementById("sagip-full-loader");

    if (loader) {
        loader.classList.remove("hidden");
    }

    updateSagipFullLoader(
        0,
        "Starting full analysis...",
        "SAGIP will load all results first, then show the completed dashboard."
    );
}

function updateSagipFullLoader(percent, stepText, detailsText) {
    const fill = document.getElementById("sagip-loader-fill");
    const percentText = document.getElementById("sagip-loader-percent");
    const step = document.getElementById("sagip-loader-step");
    const details = document.getElementById("sagip-loader-details");

    const safePercent = Math.max(0, Math.min(100, percent));

    if (fill) fill.style.width = `${safePercent}%`;
    if (percentText) percentText.textContent = `${safePercent}%`;
    if (step) step.textContent = stepText;
    if (details) details.textContent = detailsText;
}

function hideSagipFullLoader() {
    const loader = document.getElementById("sagip-full-loader");

    if (loader) {
        loader.classList.add("hidden");
    }
}