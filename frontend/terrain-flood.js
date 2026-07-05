const SAGIP_API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:8000"
        : window.location.origin;

let terrainScene = null;
let terrainCamera = null;
let terrainRenderer = null;
let terrainControls = null;
let terrainMesh = null;
let terrainWireframe = null;
let terrainAnimationId = null;

let terrainExaggeration = 1;
let terrainWireframeVisible = true;
let lastTerrainPayload = null;

let terrainColorMode = "colored";
let terrainMiniMap = null;
let terrainMiniRectangle = null;

let terrainWaterGroup = null;
let latestWaterBodies = [];
let waterAnalyzerAbortController = null;
let terrainFloodGroup = null;
let terrainFloodWaterMesh = null;
let terrainFloodWaterGeometry = null;
let terrainFloodWaterMaterial = null;
let terrainFloodRows = 0;
let terrainFloodCols = 0;
let terrainFloodVisible = true;
let terrainFloodHeightScale = 1.0;
let terrainFloodOpacity = 0.88;
let terrainFloodPlayTimer = null;
let terrainCompassNeedle = null;

const TERRAIN_WORLD_SIZE = 22;

function renderLatestTerrain3D() {
    if (!window.latestTerrainData) {
        alert("Please generate the DEM Terrain Grid first in the Area Selection tab.");
        switchTab("area");
        return;
    }

    lastTerrainPayload = window.latestTerrainData;

    switchTab("simulation");

    setTimeout(() => {
        initTerrainScene();
        buildTerrainMesh(lastTerrainPayload);
        updateTerrainInfoPanel(lastTerrainPayload);
        renderTerrainMiniMap(lastTerrainPayload);
        prepareWaterBodyAnalyzer();

        const existingWaterBodies = window.latestWaterBodies || [];

        if (existingWaterBodies.length > 0) {
            latestWaterBodies = existingWaterBodies;
            applyExistingWaterBodiesToAnalyzer(existingWaterBodies, window.latestWaterSummary || null);
            setTerrainStatus("3D terrain rendered successfully. Existing water-body scan loaded.");
        } else {
            setTerrainStatus("3D terrain rendered successfully. Scanning mapped water bodies...");

            setTimeout(() => {
                scanWaterBodiesForLatestTerrain();
            }, 600);
        }
    }, 250);
}

function initTerrainScene() {
    const container = document.getElementById("terrain-3d-viewer");

    if (!container) {
        alert("3D terrain viewer container was not found.");
        return;
    }

    if (terrainAnimationId) {
        cancelAnimationFrame(terrainAnimationId);
        terrainAnimationId = null;
    }

    container.innerHTML = "";

    terrainScene = new THREE.Scene();
    terrainScene.background = new THREE.Color(0xeef8ff);

    const width = container.clientWidth;
    const height = container.clientHeight;

    terrainCamera = new THREE.PerspectiveCamera(
        55,
        width / height,
        0.1,
        1000
    );

    terrainCamera.position.set(14, 12, 18);
    terrainCamera.lookAt(0, 0, 0);

    terrainRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
    });

    terrainRenderer.setSize(width, height);
    terrainRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    container.appendChild(terrainRenderer.domElement);

    createTerrainCompass(container);

    terrainControls = new THREE.OrbitControls(terrainCamera, terrainRenderer.domElement);
    terrainControls.enableDamping = true;
    terrainControls.dampingFactor = 0.08;
    terrainControls.rotateSpeed = 0.7;
    terrainControls.zoomSpeed = 0.8;
    terrainControls.panSpeed = 0.7;

    addTerrainLights();
    addTerrainBaseGrid();

    animateTerrainScene();

    window.addEventListener("resize", resizeTerrainViewer);
}

function addTerrainLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    terrainScene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
    sunLight.position.set(12, 18, 10);
    terrainScene.add(sunLight);

    const sideLight = new THREE.DirectionalLight(0x38bdf8, 0.25);
    sideLight.position.set(-10, 8, -10);
    terrainScene.add(sideLight);
}

function addTerrainBaseGrid() {
    const gridHelper = new THREE.GridHelper(26, 26, 0x93c5fd, 0xdbeafe);
    gridHelper.position.y = -0.08;
    terrainScene.add(gridHelper);
}

function buildTerrainMesh(data) {
    if (!terrainScene) return;

    if (terrainMesh) {
        terrainScene.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        terrainMesh.material.dispose();
        terrainMesh = null;
    }

    if (terrainWireframe) {
        terrainScene.remove(terrainWireframe);
        terrainWireframe.geometry.dispose();
        terrainWireframe.material.dispose();
        terrainWireframe = null;
    }

    const elevationGrid = data.terrain.elevation_grid;
    const summary = data.terrain.summary;

    const rows = elevationGrid.length;
    const cols = elevationGrid[0].length;

    const minElev = summary.min_elevation_m;
    const maxElev = summary.max_elevation_m;
    const elevRange = Math.max(maxElev - minElev, 1);

    const positions = [];
    const colors = [];
    const indices = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = (c / (cols - 1) - 0.5) * TERRAIN_WORLD_SIZE;
            const z = (r / (rows - 1) - 0.5) * TERRAIN_WORLD_SIZE;

            const elevation = elevationGrid[r][c];
            const normalized = (elevation - minElev) / elevRange;

            const y = normalized * 4.5 * terrainExaggeration;

            positions.push(x, y, z);

            const color = getTerrainColor(normalized);
            colors.push(color.r, color.g, color.b);
        }
    }

    for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
            const topLeft = r * cols + c;
            const topRight = topLeft + 1;
            const bottomLeft = (r + 1) * cols + c;
            const bottomRight = bottomLeft + 1;

            indices.push(topLeft, bottomLeft, topRight);
            indices.push(topRight, bottomLeft, bottomRight);
        }
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3)
    );

    geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colors, 3)
    );

    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        shininess: 0,
    });

    terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.rotation.x = 0;
    terrainScene.add(terrainMesh);

    const wireMaterial = new THREE.MeshBasicMaterial({
        color: 0x0f172a,
        wireframe: true,
        transparent: true,
        opacity: 0.18,
    });

    terrainWireframe = new THREE.Mesh(geometry.clone(), wireMaterial);
    terrainWireframe.visible = terrainWireframeVisible;
    terrainScene.add(terrainWireframe);

    addLowPointMarkers(data);

    if (latestWaterBodies && latestWaterBodies.length > 0) {
        drawWaterBodiesOnTerrain(latestWaterBodies);
    }
    if (window.latestFloodSnapshot) {
        renderFloodSnapshotOnTerrain(window.latestFloodSnapshot);
    }

}

function addLowPointMarkers(data) {
    const oldMarkers = terrainScene.children.filter(
        (child) => child.userData && child.userData.type === "low-point-marker"
    );

    oldMarkers.forEach((marker) => {
        terrainScene.remove(marker);
        marker.geometry.dispose();
        marker.material.dispose();
    });

    const lowPoints = data.terrain.low_points || [];
    const elevationGrid = data.terrain.elevation_grid;
    const summary = data.terrain.summary;

    const rows = elevationGrid.length;
    const cols = elevationGrid[0].length;

    const minElev = summary.min_elevation_m;
    const maxElev = summary.max_elevation_m;
    const elevRange = Math.max(maxElev - minElev, 1);

    const markersToShow = lowPoints.slice(0, 30);

    markersToShow.forEach((point) => {
        const r = point.row;
        const c = point.col;

        const x = (c / (cols - 1) - 0.5) * TERRAIN_WORLD_SIZE;
        const z = (r / (rows - 1) - 0.5) * TERRAIN_WORLD_SIZE;

        const elevation = elevationGrid[r][c];
        const normalized = (elevation - minElev) / elevRange;
        const y = normalized * 4.5 * terrainExaggeration + 0.18;

        const markerGeometry = new THREE.SphereGeometry(0.13, 12, 12);
        const markerMaterial = new THREE.MeshBasicMaterial({
            color: 0xef4444,
        });

        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.set(x, y, z);
        marker.userData.type = "low-point-marker";

        terrainScene.add(marker);
    });
}

function getTerrainColor(t) {
    if (terrainColorMode === "gray") {
        return getGrayElevationColor(t);
    }

    return getColoredElevationColor(t);
}

function getColoredElevationColor(t) {
    t = Math.max(0, Math.min(1, t));

    if (t < 0.2) {
        return new THREE.Color(0x38bdf8);
    }

    if (t < 0.4) {
        return new THREE.Color(0x22c55e);
    }

    if (t < 0.65) {
        return new THREE.Color(0xfacc15);
    }

    if (t < 0.82) {
        return new THREE.Color(0xfb923c);
    }

    return new THREE.Color(0x8b5a2b);
}

function getGrayElevationColor(t) {
    t = Math.max(0, Math.min(1, t));

    const shade = 0.18 + t * 0.72;

    return new THREE.Color(shade, shade, shade);
}

function animateTerrainScene() {
    terrainAnimationId = requestAnimationFrame(animateTerrainScene);

    if (terrainControls) {
        terrainControls.update();
    }

    updateTerrainCompass();

    if (terrainRenderer && terrainScene && terrainCamera) {
        terrainRenderer.render(terrainScene, terrainCamera);
    }
}

function resizeTerrainViewer() {
    const container = document.getElementById("terrain-3d-viewer");

    if (!container || !terrainRenderer || !terrainCamera) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    terrainCamera.aspect = width / height;
    terrainCamera.updateProjectionMatrix();

    terrainRenderer.setSize(width, height);
}

function resetTerrainCamera() {
    resetTerrainNorthView();
}

function toggleTerrainWireframe() {
    if (!terrainWireframe) {
        alert("Render the 3D terrain first.");
        return;
    }

    terrainWireframeVisible = !terrainWireframeVisible;
    terrainWireframe.visible = terrainWireframeVisible;
}

function setTerrainExaggeration(value) {
    terrainExaggeration = Number(value);

    if (lastTerrainPayload && terrainScene) {
        buildTerrainMesh(lastTerrainPayload);
        setTerrainStatus(`Vertical exaggeration set to ${terrainExaggeration.toFixed(1)}×.`);
    }
}

function updateTerrainInfoPanel(data) {
    const source = document.getElementById("terrain-info-source");
    const resolution = document.getElementById("terrain-info-resolution");
    const range = document.getElementById("terrain-info-range");
    const type = document.getElementById("terrain-info-type");

    if (!data || !data.terrain || !data.terrain.summary) return;

    const summary = data.terrain.summary;

    if (source) source.textContent = data.terrain.source;
    if (resolution) resolution.textContent = `${data.terrain.resolution} × ${data.terrain.resolution}`;
    if (range) range.textContent = `${summary.elevation_range_m} m`;
    if (type) type.textContent = summary.terrain_type;
}

function setTerrainStatus(message) {
    const status = document.getElementById("terrain-viewer-status");

    if (status) {
        status.textContent = message;
    }
}

function toggleTerrainColorMode() {
    terrainColorMode = terrainColorMode === "colored" ? "gray" : "colored";

    const button = document.getElementById("terrain-color-toggle");

    if (button) {
        button.textContent = terrainColorMode === "colored" ? "Gray Mode" : "Colored Mode";
    }

    if (lastTerrainPayload && terrainScene) {
        buildTerrainMesh(lastTerrainPayload);
        setTerrainStatus(
            terrainColorMode === "colored"
                ? "Colored elevation mode enabled."
                : "Gray monotone terrain mode enabled."
        );
    }
}

function renderTerrainMiniMap(data) {
    const miniMapElement = document.getElementById("terrain-minimap");

    if (!miniMapElement || !data || !data.terrain) return;

    const latitudes = data.terrain.latitudes;
    const longitudes = data.terrain.longitudes;

    if (!latitudes || !longitudes || latitudes.length === 0 || longitudes.length === 0) {
        return;
    }

    const north = Math.max(...latitudes);
    const south = Math.min(...latitudes);
    const east = Math.max(...longitudes);
    const west = Math.min(...longitudes);

    const centerLat = (north + south) / 2;
    const centerLng = (east + west) / 2;

    if (terrainMiniMap) {
        terrainMiniMap.remove();
        terrainMiniMap = null;
        terrainMiniRectangle = null;
    }

    terrainMiniMap = L.map("terrain-minimap", {
        center: [centerLat, centerLng],
        zoom: 12,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        tap: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
    }).addTo(terrainMiniMap);

    const bounds = [
        [south, west],
        [north, east],
    ];

    terrainMiniRectangle = L.rectangle(bounds, {
        className: "terrain-minimap-rectangle",
        color: "#0284c7",
        weight: 3,
        fillColor: "#38bdf8",
        fillOpacity: 0.18,
    }).addTo(terrainMiniMap);

    terrainMiniMap.fitBounds(bounds, {
        padding: [18, 18],
        maxZoom: 15,
    });

    setTimeout(() => {
        terrainMiniMap.invalidateSize();
    }, 200);
}

function prepareWaterBodyAnalyzer() {
    const section = document.getElementById("water-analyzer-section");
    const status = document.getElementById("water-analyzer-status");
    const summary = document.getElementById("water-analyzer-summary");
    const canvas = document.getElementById("waterBodyCanvas");

    if (section) {
        section.classList.remove("hidden");
    }

    if (status) {
        status.textContent = "Queued";
        status.className = "water-analyzer-badge loading";
    }

    if (summary) {
        summary.textContent = "Water Body Analyzer is ready. It will scan rivers, streams, canals, drains, lakes, ponds, and reservoirs inside the selected area.";
    }

    if (canvas) {
        const ctx = canvas.getContext("2d");
        const size = Math.min(canvas.clientWidth || 680, 680);

        canvas.width = size;
        canvas.height = size;

        drawWaterAnalyzerGrid(ctx, size);
    }

    renderDetectedWaterBodies([]);
    updateWaterMetrics({
        total_count: 0,
        river_count: 0,
        stream_count: 0,
        drainage_count: 0,
        storage_count: 0,
    });
}

function getTerrainBboxFromPayload(data) {
    const latitudes = data?.terrain?.latitudes || [];
    const longitudes = data?.terrain?.longitudes || [];

    if (!latitudes.length || !longitudes.length) {
        return null;
    }

    return {
        north: Math.max(...latitudes),
        south: Math.min(...latitudes),
        east: Math.max(...longitudes),
        west: Math.min(...longitudes),
    };
}

async function scanWaterBodiesForLatestTerrain() {
    if (!lastTerrainPayload) {
        alert("Render or generate terrain first.");
        return;
    }

    const bbox = getTerrainBboxFromPayload(lastTerrainPayload);

    if (!bbox) {
        alert("Could not read terrain bounds.");
        return;
    }

    const status = document.getElementById("water-analyzer-status");
    const summary = document.getElementById("water-analyzer-summary");

    if (waterAnalyzerAbortController) {
        waterAnalyzerAbortController.abort();
    }

    waterAnalyzerAbortController = new AbortController();

    if (status) {
        status.textContent = "Scanning";
        status.className = "water-analyzer-badge loading";
    }

    if (summary) {
        summary.textContent = "Scanning OpenStreetMap data for flood-relevant water features...";
    }

    const canvas = document.getElementById("waterBodyCanvas");
    if (canvas) {
        const ctx = canvas.getContext("2d");
        const size = Math.min(canvas.clientWidth || 680, 680);
        canvas.width = size;
        canvas.height = size;
        drawWaterAnalyzerGrid(ctx, size);
    }

    try {
        const response = await fetch(`${SAGIP_API_BASE}/api/water-bodies`, {
            method: "POST",
            signal: waterAnalyzerAbortController.signal,
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(bbox),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Water-body scan failed.");
        }

        latestWaterBodies = data.water.water_bodies || [];
        window.latestWaterBodies = latestWaterBodies;

        drawWaterBodiesOnCanvas(latestWaterBodies, bbox);
        renderDetectedWaterBodies(latestWaterBodies);
        updateWaterMetrics(data.water.summary);
        drawWaterBodiesOnTerrain(latestWaterBodies);

        if (status) {
            status.textContent = latestWaterBodies.length ? `${latestWaterBodies.length} found` : "0 found";
            status.className = latestWaterBodies.length
                ? "water-analyzer-badge success"
                : "water-analyzer-badge error";
        }

        if (summary) {
            summary.textContent =
                `${latestWaterBodies.length} mapped water feature(s) detected. ` +
                "These features are now shown on the 2D analyzer and overlaid on the 3D terrain. " +
                "Later, SAGIP will use them as flood simulation modifiers.";
        }

    } catch (error) {
        if (error.name === "AbortError") return;

        console.error("Water Body Analyzer failed:", error);

        latestWaterBodies = [];
        window.latestWaterBodies = [];

        drawWaterBodiesOnCanvas([], bbox);
        renderDetectedWaterBodies([]);
        updateWaterMetrics({
            total_count: 0,
            river_count: 0,
            stream_count: 0,
            drainage_count: 0,
            storage_count: 0,
        });

        if (status) {
            status.textContent = "Failed";
            status.className = "water-analyzer-badge error";
        }

        if (summary) {
            summary.innerHTML = `
        <strong>Water scan failed.</strong><br>
        Reason: ${escapeHtml(error.message)}<br><br>
        Check if the backend is running, then test /api/water-bodies in FastAPI docs.
        `;
        }
    }
}

function drawWaterAnalyzerGrid(ctx, size) {
    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = "#f8fbff";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "#dbeafe";
    ctx.lineWidth = 1;

    const divisions = 10;

    for (let i = 0; i <= divisions; i++) {
        const p = (i / divisions) * size;

        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
    }

    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, size - 4, size - 4);

    ctx.fillStyle = "#64748b";
    ctx.font = "13px Outfit, sans-serif";
    ctx.fillText("Selected SAGIP analysis area", 14, 24);
}

function drawWaterBodiesOnCanvas(waterBodies, bbox) {
    const canvas = document.getElementById("waterBodyCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const size = Math.min(canvas.clientWidth || 680, 680);

    canvas.width = size;
    canvas.height = size;

    drawWaterAnalyzerGrid(ctx, size);

    if (!waterBodies || waterBodies.length === 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = "14px Outfit, sans-serif";
        ctx.fillText("No mapped water features detected in this rectangle.", 14, 48);
        return;
    }

    waterBodies.forEach((feature) => {
        const importance = Number(feature.overflow_importance || 0.5);

        ctx.strokeStyle = getCanvasWaterColor(importance);
        ctx.lineWidth = Math.max(2, Math.min(8, importance * 7));
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const geometries = feature.geometries || [];

        geometries.forEach((geometry) => {
            if (!geometry || geometry.length < 2) return;

            ctx.beginPath();

            geometry.forEach((point, index) => {
                const x = ((point.lon - bbox.west) / (bbox.east - bbox.west)) * size;
                const y = ((bbox.north - point.lat) / (bbox.north - bbox.south)) * size;

                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });

            ctx.stroke();
        });
    });
}

function getCanvasWaterColor(importance) {
    if (importance >= 0.85) return "#1e40af";
    if (importance >= 0.65) return "#2563eb";
    if (importance >= 0.5) return "#0ea5e9";
    return "#7dd3fc";
}

function renderDetectedWaterBodies(waterBodies) {
    const countEl = document.getElementById("detected-water-count");
    const listEl = document.getElementById("detected-water-list");

    if (countEl) {
        countEl.textContent = `${waterBodies.length} found`;
    }

    if (!listEl) return;

    if (!waterBodies || waterBodies.length === 0) {
        listEl.innerHTML = `
            <div class="detected-water-empty">
                No mapped water features detected yet. This may mean the selected area has no mapped OSM water features,
                or the Overpass server is temporarily unavailable.
            </div>
        `;
        return;
    }

    listEl.innerHTML = waterBodies.map((item) => {
        const geometryCount = item.geometries
            ? item.geometries.reduce((sum, geometry) => sum + geometry.length, 0)
            : 0;

        return `
            <div class="water-detail-card">
                <div class="water-detail-top">
                    <div class="water-detail-name">${escapeHtml(item.name || "Unnamed water feature")}</div>
                    <div class="water-detail-type">${escapeHtml(item.category || "Water Feature")}</div>
                </div>

                <div class="water-detail-body">
                    <p>${escapeHtml(item.flood_role || "May affect local flood behavior.")}</p>

                    <div class="water-detail-metrics">
                        <div class="water-detail-metric">
                            <span>Overflow Proxy</span>
                            <strong>${Math.round((item.overflow_importance || 0) * 100)}%</strong>
                        </div>

                        <div class="water-detail-metric">
                            <span>Est. Width</span>
                            <strong>${item.estimated_width_m || "—"} m</strong>
                        </div>

                        <div class="water-detail-metric">
                            <span>Geometry Points</span>
                            <strong>${geometryCount}</strong>
                        </div>

                        <div class="water-detail-metric">
                            <span>Source</span>
                            <strong>OSM</strong>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

function updateWaterMetrics(summary) {
    const total = document.getElementById("water-total-count");
    const rivers = document.getElementById("water-river-count");
    const streams = document.getElementById("water-stream-count");
    const drainage = document.getElementById("water-drainage-count");
    const storage = document.getElementById("water-storage-count");

    if (total) total.textContent = summary.total_count ?? 0;
    if (rivers) rivers.textContent = summary.river_count ?? 0;
    if (streams) streams.textContent = summary.stream_count ?? 0;
    if (drainage) drainage.textContent = summary.drainage_count ?? 0;
    if (storage) storage.textContent = summary.storage_count ?? 0;
}

function drawWaterBodiesOnTerrain(waterBodies) {
    if (!terrainScene || !lastTerrainPayload) return;

    if (terrainWaterGroup) {
        terrainScene.remove(terrainWaterGroup);

        terrainWaterGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });

        terrainWaterGroup = null;
    }

    terrainWaterGroup = new THREE.Group();
    terrainWaterGroup.name = "SAGIP Embedded River Overlay";

    if (!waterBodies || waterBodies.length === 0) {
        terrainScene.add(terrainWaterGroup);
        return;
    }

    waterBodies.forEach((feature) => {
        const importance = Number(feature.overflow_importance || 0.5);
        const color = getThreeWaterColor(importance);
        const width = getEmbeddedRiverWidth(feature);

        const material = new THREE.MeshPhongMaterial({
            color: color,
            transparent: true,
            opacity: 0.78,
            shininess: 45,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const geometries = feature.geometries || [];

        geometries.forEach((geometry) => {
            if (!geometry || geometry.length < 2) return;

            const sampled = sampleGeometryPoints(geometry, 100);

            const points3D = sampled
                .map((point) => latLngToTerrainPoint(point.lat, point.lon))
                .filter(Boolean);

            if (points3D.length < 2) return;

            const riverMesh = buildEmbeddedRiverRibbon(points3D, width, material.clone());

            if (riverMesh) {
                riverMesh.userData.type = "embedded-water-overlay";
                riverMesh.userData.name = feature.name;
                riverMesh.userData.category = feature.category;
                terrainWaterGroup.add(riverMesh);
            }
        });
    });

    terrainScene.add(terrainWaterGroup);
}

function buildEmbeddedRiverRibbon(points, width, material) {
    if (!points || points.length < 2) return null;

    const positions = [];
    const indices = [];

    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const previous = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];

        const direction = new THREE.Vector3(
            next.x - previous.x,
            0,
            next.z - previous.z
        );

        if (direction.lengthSq() < 0.000001) {
            direction.set(1, 0, 0);
        }

        direction.normalize();

        const side = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(width / 2);

        // Slightly above the terrain to avoid z-fighting, but low enough to look embedded.
        const y = current.y + 0.025;

        positions.push(
            current.x - side.x, y, current.z - side.z,
            current.x + side.x, y, current.z + side.z
        );
    }

    for (let i = 0; i < points.length - 1; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;

        indices.push(a, c, b);
        indices.push(b, c, d);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return new THREE.Mesh(geometry, material);
}

function getEmbeddedRiverWidth(feature) {
    const category = String(feature.category || "").toLowerCase();
    const importance = Number(feature.overflow_importance || 0.5);

    if (category.includes("river") || category.includes("reservoir")) {
        return 0.22 + importance * 0.22;
    }

    if (category.includes("stream")) {
        return 0.11 + importance * 0.14;
    }

    return 0.08 + importance * 0.10;
}

function getThreeWaterColor(importance) {
    if (importance >= 0.85) return 0x1e40af;
    if (importance >= 0.65) return 0x2563eb;
    if (importance >= 0.5) return 0x0ea5e9;
    return 0x7dd3fc;
}

function getThreeWaterRadius(feature) {
    const importance = Number(feature.overflow_importance || 0.5);

    return 0.035 + importance * 0.055;
}

function sampleGeometryPoints(geometry, maxPoints) {
    if (geometry.length <= maxPoints) return geometry;

    const step = Math.max(1, Math.ceil(geometry.length / maxPoints));

    const sampled = geometry.filter((_, index) => index % step === 0);

    if (sampled[sampled.length - 1] !== geometry[geometry.length - 1]) {
        sampled.push(geometry[geometry.length - 1]);
    }

    return sampled;
}

function latLngToTerrainPoint(lat, lng) {
    const data = lastTerrainPayload;
    const bbox = getTerrainBboxFromPayload(data);

    if (!data || !bbox) return null;

    if (lat > bbox.north || lat < bbox.south || lng > bbox.east || lng < bbox.west) {
        return null;
    }

    const x = ((lng - bbox.west) / (bbox.east - bbox.west) - 0.5) * TERRAIN_WORLD_SIZE;
    const z = ((bbox.north - lat) / (bbox.north - bbox.south) - 0.5) * TERRAIN_WORLD_SIZE;

    const y = getTerrainYAtLatLng(lat, lng) + 0.18;

    return new THREE.Vector3(x, y, z);
}

function getTerrainYAtLatLng(lat, lng) {
    const data = lastTerrainPayload;
    const bbox = getTerrainBboxFromPayload(data);

    if (!data || !bbox) return 0;

    const grid = data.terrain.elevation_grid;
    const summary = data.terrain.summary;

    const rows = grid.length;
    const cols = grid[0].length;

    const r = Math.round(((bbox.north - lat) / (bbox.north - bbox.south)) * (rows - 1));
    const c = Math.round(((lng - bbox.west) / (bbox.east - bbox.west)) * (cols - 1));

    const safeR = Math.max(0, Math.min(rows - 1, r));
    const safeC = Math.max(0, Math.min(cols - 1, c));

    const elevation = grid[safeR][safeC];

    const minElev = summary.min_elevation_m;
    const maxElev = summary.max_elevation_m;
    const elevRange = Math.max(maxElev - minElev, 1);

    const normalized = (elevation - minElev) / elevRange;

    return normalized * 4.5 * terrainExaggeration;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function createTerrainCompass(container) {
    const oldCompass = document.getElementById("terrain-compass");

    if (oldCompass) {
        oldCompass.remove();
    }

    const compass = document.createElement("button");
    compass.id = "terrain-compass";
    compass.className = "terrain-compass";
    compass.type = "button";
    compass.title = "Click to return to north-up view";
    compass.setAttribute("aria-label", "3D terrain compass. Click to return to north-up view.");

    compass.innerHTML = `
        <div>
            <div class="terrain-compass-ring">
                <div class="terrain-compass-letter">N</div>
                <div class="terrain-compass-needle" id="terrain-compass-needle"></div>
                <div class="terrain-compass-center"></div>
            </div>
            <div class="terrain-compass-caption">North<br>Reset</div>
        </div>
    `;

    compass.addEventListener("click", resetTerrainNorthView);

    container.appendChild(compass);

    terrainCompassNeedle = document.getElementById("terrain-compass-needle");
}

function updateTerrainCompass() {
    if (!terrainCamera || !terrainControls || !terrainCompassNeedle) return;

    const targetPoint = terrainControls.target.clone();

    /*
      In SAGIP's 3D terrain:
      - negative Z direction represents north
      - positive Z direction represents south
      - positive X direction represents east
      - negative X direction represents west

      This projects the real 3D north direction into screen space,
      then rotates the compass needle so it points toward north on screen.
    */

    const northPoint = targetPoint.clone().add(new THREE.Vector3(0, 0, -6));

    const projectedTarget = targetPoint.clone().project(terrainCamera);
    const projectedNorth = northPoint.clone().project(terrainCamera);

    const dx = projectedNorth.x - projectedTarget.x;
    const dy = projectedNorth.y - projectedTarget.y;

    const angle = Math.atan2(dx, dy);

    terrainCompassNeedle.style.transform = `rotate(${angle}rad)`;
}

function resetTerrainNorthView() {
    if (!terrainCamera || !terrainControls) {
        alert("Render the 3D terrain first.");
        return;
    }

    terrainControls.target.set(0, 1.5, 0);

    /*
      Camera placed south of the terrain looking north.
      This makes north appear toward the top of the 3D viewer.
    */
    terrainCamera.position.set(0, 12, 18);
    terrainCamera.lookAt(0, 1.5, 0);

    terrainControls.update();

    setTerrainStatus("Camera returned to north-up orientation.");
}

function renderFloodSnapshotOnTerrain(snapshot) {
    if (!terrainScene || !lastTerrainPayload || !snapshot) return;

    const depthGrid = snapshot.depth_grid_cm;

    if (!depthGrid || !depthGrid.length || !depthGrid[0] || !depthGrid[0].length) {
        clearTerrainFloodOverlay();
        return;
    }

    rebuildTerrainFloodWaterMesh(snapshot);
    updateTerrainFloodControlPanel(snapshot);

    window.latestFloodSnapshot = snapshot;
}

function rebuildTerrainFloodWaterMesh(snapshot) {
    clearTerrainFloodOverlay();

    const rawDepthGrid = snapshot.depth_grid_cm;
    const depthGrid = smoothTerrainFloodDepthGrid(rawDepthGrid);
    const rows = depthGrid.length;
    const cols = depthGrid[0].length;

    terrainFloodRows = rows;
    terrainFloodCols = cols;

    terrainFloodGroup = new THREE.Group();
    terrainFloodGroup.name = "SAGIP Natural 3D Flood Surface";
    terrainFloodGroup.visible = terrainFloodVisible;

    const buckets = [
        { min: 0.00, max: 0.26, opacity: terrainFloodOpacity * 0.18, positions: [], colors: [], indices: [], vertexIndex: 0 },
        { min: 0.26, max: 0.46, opacity: terrainFloodOpacity * 0.34, positions: [], colors: [], indices: [], vertexIndex: 0 },
        { min: 0.46, max: 0.68, opacity: terrainFloodOpacity * 0.55, positions: [], colors: [], indices: [], vertexIndex: 0 },
        { min: 0.68, max: 1.01, opacity: terrainFloodOpacity * 0.82, positions: [], colors: [], indices: [], vertexIndex: 0 },
    ];

    const minimumVisibleDepthCm = 1;
    const hourIndex = snapshot.hour_index || 0;

    for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
            const d00 = Number(depthGrid[r][c] || 0);
            const d01 = Number(depthGrid[r][c + 1] || 0);
            const d10 = Number(depthGrid[r + 1][c] || 0);
            const d11 = Number(depthGrid[r + 1][c + 1] || 0);

            const maxDepth = Math.max(d00, d01, d10, d11);
            const avgDepth = (d00 + d01 + d10 + d11) / 4;

            if (maxDepth < minimumVisibleDepthCm) continue;

            const edgeFactor = getFloodEdgeFactor(depthGrid, r, c);
            const depthFactor = Math.min(1, avgDepth / 80);
            const alphaFactor = Math.max(0.12, Math.min(1, edgeFactor * 0.75 + depthFactor * 0.25));

            const bucket = buckets.find((item) => alphaFactor >= item.min && alphaFactor < item.max) || buckets[0];

            const x0 = (c / Math.max(cols - 1, 1) - 0.5) * TERRAIN_WORLD_SIZE;
            const x1 = ((c + 1) / Math.max(cols - 1, 1) - 0.5) * TERRAIN_WORLD_SIZE;
            const z0 = (r / Math.max(rows - 1, 1) - 0.5) * TERRAIN_WORLD_SIZE;
            const z1 = ((r + 1) / Math.max(rows - 1, 1) - 0.5) * TERRAIN_WORLD_SIZE;

            const y00 = buildFloodVertexY(r, c, d00, maxDepth, hourIndex);
            const y01 = buildFloodVertexY(r, c + 1, d01, maxDepth, hourIndex);
            const y10 = buildFloodVertexY(r + 1, c, d10, maxDepth, hourIndex);
            const y11 = buildFloodVertexY(r + 1, c + 1, d11, maxDepth, hourIndex);

            bucket.positions.push(
                x0, y00, z0,
                x1, y01, z0,
                x0, y10, z1,
                x1, y11, z1
            );

            const c00 = getTerrainFloodWaterColor(Math.max(d00, maxDepth * 0.22));
            const c01 = getTerrainFloodWaterColor(Math.max(d01, maxDepth * 0.22));
            const c10 = getTerrainFloodWaterColor(Math.max(d10, maxDepth * 0.22));
            const c11 = getTerrainFloodWaterColor(Math.max(d11, maxDepth * 0.22));

            bucket.colors.push(
                c00.r, c00.g, c00.b,
                c01.r, c01.g, c01.b,
                c10.r, c10.g, c10.b,
                c11.r, c11.g, c11.b
            );

            bucket.indices.push(
                bucket.vertexIndex, bucket.vertexIndex + 2, bucket.vertexIndex + 1,
                bucket.vertexIndex + 1, bucket.vertexIndex + 2, bucket.vertexIndex + 3
            );

            bucket.vertexIndex += 4;
        }
    }

    let meshCount = 0;

    buckets.forEach((bucket) => {
        if (!bucket.positions.length) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3));
        geometry.setIndex(bucket.indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            color: 0x0ea5e9,
            transparent: true,
            opacity: Math.max(0.45, bucket.opacity),
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "Natural Forecast Floodwater Surface";
        mesh.renderOrder = 20 + meshCount;

        terrainFloodGroup.add(mesh);
        meshCount += 1;
    });

    terrainScene.add(terrainFloodGroup);

    // Compatibility with older controls that check this variable.
    terrainFloodWaterMesh = terrainFloodGroup.children[0] || null;
}

function smoothTerrainFloodDepthGrid(depthGrid) {
    const rows = depthGrid.length;
    const cols = depthGrid[0].length;
    const output = [];

    for (let r = 0; r < rows; r++) {
        const row = [];

        for (let c = 0; c < cols; c++) {
            let sum = 0;
            let weightSum = 0;

            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    const rr = r + dr;
                    const cc = c + dc;

                    if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;

                    const weight = dr === 0 && dc === 0 ? 4 : 1;
                    sum += Number(depthGrid[rr][cc] || 0) * weight;
                    weightSum += weight;
                }
            }

            row.push(sum / Math.max(1, weightSum));
        }

        output.push(row);
    }

    return output;
}

function getFloodEdgeFactor(depthGrid, row, col) {
    const rows = depthGrid.length;
    const cols = depthGrid[0].length;

    let floodedNeighbors = 0;
    let totalNeighbors = 0;

    for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
            const rr = row + dr;
            const cc = col + dc;

            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;

            totalNeighbors += 1;

            if (Number(depthGrid[rr][cc] || 0) >= 1) {
                floodedNeighbors += 1;
            }
        }
    }

    return floodedNeighbors / Math.max(1, totalNeighbors);
}

function buildFloodVertexY(row, col, depthCm, nearbyMaxDepthCm, hourIndex) {
    const groundY = getTerrainYFromGridCell(row, col);

    const effectiveDepth = depthCm > 0
        ? depthCm
        : nearbyMaxDepthCm * 0.12;

    const waterRiseY = getTerrainFloodVisualHeight(effectiveDepth);
    const rippleY = Math.sin((row + col) * 0.33 + hourIndex * 0.18) * 0.012;

    return groundY + 0.055 + waterRiseY + rippleY;
}

function getTerrainFloodVisualHeight(depthCm) {
    const scaledDepth = depthCm * terrainFloodHeightScale;

    /*
      Real depth is in centimeters, but the 3D scene is visually normalized.
      This converts simulated flood depth into game-map style visible water rise.
    */
    return Math.min(3.2, scaledDepth / 55);
}

function getTerrainFloodWaterColor(depthCm) {
    depthCm = Number(depthCm || 0);

    if (depthCm >= 120) return new THREE.Color(0x003b95);
    if (depthCm >= 80) return new THREE.Color(0x0057d9);
    if (depthCm >= 50) return new THREE.Color(0x0077ff);
    if (depthCm >= 25) return new THREE.Color(0x0ea5e9);
    if (depthCm >= 8) return new THREE.Color(0x38bdf8);

    return new THREE.Color(0x60a5fa);
}

function clearTerrainFloodOverlay() {
    if (!terrainScene || !terrainFloodGroup) return;

    terrainScene.remove(terrainFloodGroup);

    terrainFloodGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach((material) => material.dispose());
            } else {
                child.material.dispose();
            }
        }
    });

    terrainFloodGroup = null;
    terrainFloodWaterMesh = null;
    terrainFloodWaterGeometry = null;
    terrainFloodWaterMaterial = null;
    terrainFloodRows = 0;
    terrainFloodCols = 0;
}

function classifyFloodDepthForTerrain(depthCm) {
    if (depthCm >= 80) return "severe";
    if (depthCm >= 40) return "high";
    if (depthCm >= 15) return "moderate";
    return "low";
}

function getTerrainYFromGridCell(row, col) {
    if (!lastTerrainPayload || !lastTerrainPayload.terrain) return 0;

    const grid = lastTerrainPayload.terrain.elevation_grid;
    const summary = lastTerrainPayload.terrain.summary;

    const rows = grid.length;
    const cols = grid[0].length;

    const safeRow = Math.max(0, Math.min(rows - 1, row));
    const safeCol = Math.max(0, Math.min(cols - 1, col));

    const elevation = grid[safeRow][safeCol];

    const minElev = summary.min_elevation_m;
    const maxElev = summary.max_elevation_m;
    const elevRange = Math.max(maxElev - minElev, 1);

    const normalized = (elevation - minElev) / elevRange;

    return normalized * 4.5 * terrainExaggeration;
}

function updateTerrainFloodControlPanel(snapshot) {
    if (!snapshot) return;

    const hour = document.getElementById("terrain-flood-hour");
    const rain = document.getElementById("terrain-flood-rainfall");
    const maxDepth = document.getElementById("terrain-flood-max-depth");
    const flooded = document.getElementById("terrain-flood-cells");
    const risk = document.getElementById("terrain-flood-risk");

    if (hour) hour.textContent = `Hour ${snapshot.hour_index ?? 0}`;

    const weather = getTerrainFloodWeatherForHour(snapshot.hour_index ?? 0);
    const rainfall = Number(
        weather?.precipitation_mm ??
        weather?.rain_mm ??
        snapshot.rainfall_mm ??
        0
    );

    if (rain) rain.textContent = `${rainfall.toFixed(2)} mm/hr`;
    if (maxDepth) maxDepth.textContent = `${Number(snapshot.max_depth_cm || 0).toFixed(1)} cm`;
    if (flooded) flooded.textContent = snapshot.flooded_cell_count ?? 0;
    if (risk) risk.textContent = terrainFloodRiskLabel(snapshot);
}

function getTerrainFloodWeatherForHour(hourIndex) {
    const hourly = window.latestRainfallForecast?.forecast?.hourly || [];

    if (!hourly.length) return null;

    return hourly[Math.max(0, Math.min(hourly.length - 1, hourIndex))];
}

function terrainFloodRiskLabel(snapshot) {
    const maxDepth = Number(snapshot.max_depth_cm || 0);
    const highCells = Number(snapshot.high_or_severe_cell_count || 0);
    const floodedCells = Number(snapshot.flooded_cell_count || 0);

    if (maxDepth >= 100 || highCells >= 250) return "Severe";
    if (maxDepth >= 60 || highCells >= 100) return "High";
    if (maxDepth >= 25 || floodedCells >= 400) return "Moderate";
    if (maxDepth >= 5 || floodedCells > 0) return "Low";
    return "None";
}

function setTerrainFloodWaterOpacity(value) {
    terrainFloodOpacity = Number(value);

    const label = document.getElementById("terrain-flood-opacity-label");
    if (label) label.textContent = terrainFloodOpacity.toFixed(2);

    if (window.latestFloodSnapshot) {
        renderFloodSnapshotOnTerrain(window.latestFloodSnapshot);
    }
}

function setTerrainFloodHeightScale(value) {
    terrainFloodHeightScale = Number(value);

    const label = document.getElementById("terrain-flood-height-label");
    if (label) label.textContent = `${terrainFloodHeightScale.toFixed(1)}×`;

    if (window.latestFloodSnapshot) {
        renderFloodSnapshotOnTerrain(window.latestFloodSnapshot);
    }
}

function toggleTerrainFloodWater(checked) {
    terrainFloodVisible = Boolean(checked);

    if (terrainFloodGroup) {
        terrainFloodGroup.visible = terrainFloodVisible;
    }
}

function applyLatestFloodSnapshotToTerrain() {
    if (!terrainScene || !lastTerrainPayload) {
        alert("Render the 3D terrain first.");
        return;
    }

    if (window.latestFloodSnapshot) {
        renderFloodSnapshotOnTerrain(window.latestFloodSnapshot);
        setTerrainStatus("Live floodwater surface applied to 3D terrain.");
        return;
    }

    const simulation = window.latestFloodSimulation || latestFloodSimulation;

    if (simulation?.snapshots?.length) {
        renderFloodSnapshotOnTerrain(simulation.snapshots[0]);
        setTerrainStatus("First flood simulation snapshot applied to 3D terrain.");
        return;
    }

    alert("Run Flood Simulation first so SAGIP has live forecast-based flood snapshots.");
}

function applyExistingWaterBodiesToAnalyzer(waterBodies, summaryData) {
    const bbox = getTerrainBboxFromPayload(lastTerrainPayload);

    if (!bbox) return;

    drawWaterBodiesOnCanvas(waterBodies, bbox);
    renderDetectedWaterBodies(waterBodies);

    const summary = summaryData || buildWaterSummaryFallback(waterBodies);
    updateWaterMetrics(summary);

    drawWaterBodiesOnTerrain(waterBodies);

    const status = document.getElementById("water-analyzer-status");
    const summaryBox = document.getElementById("water-analyzer-summary");

    if (status) {
        status.textContent = waterBodies.length ? `${waterBodies.length} found` : "0 found";
        status.className = waterBodies.length
            ? "water-analyzer-badge success"
            : "water-analyzer-badge error";
    }

    if (summaryBox) {
        summaryBox.textContent =
            `${waterBodies.length} mapped water feature(s) loaded from the full SAGIP analysis. ` +
            "These features are shown on the 2D analyzer and overlaid on the 3D terrain.";
    }
}

function buildWaterSummaryFallback(waterBodies) {
    return {
        total_count: waterBodies.length,
        river_count: waterBodies.filter((item) => item.category === "River").length,
        stream_count: waterBodies.filter((item) => item.category === "Stream").length,
        drainage_count: waterBodies.filter((item) => item.category === "Canal / Drainage").length,
        storage_count: waterBodies.filter((item) => item.category === "Lake / Pond / Reservoir").length,
    };
}