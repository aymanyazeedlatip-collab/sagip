let areaMap = null;
let selectionRectangle = null;
let userLocationMarker = null;
let userLocationCircle = null;

const DEFAULT_CENTER = [14.5995, 120.9842]; // Manila default
let currentSizeKm = 3;

function initAreaMap() {
    areaMap = L.map("area-map", {
        center: DEFAULT_CENTER,
        zoom: 13,
        zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(areaMap);

    createRectangleAtCenter(currentSizeKm);

    areaMap.on("moveend", () => {
        updateBboxDisplay();
    });
}

function kmToLatDegrees(km) {
    return km / 111.32;
}

function kmToLngDegrees(km, lat) {
    return km / (111.32 * Math.cos(lat * Math.PI / 180));
}

function createRectangleAtCenter(sizeKm) {
    const center = areaMap.getCenter();

    const halfLat = kmToLatDegrees(sizeKm / 2);
    const halfLng = kmToLngDegrees(sizeKm / 2, center.lat);

    const bounds = [
        [center.lat - halfLat, center.lng - halfLng],
        [center.lat + halfLat, center.lng + halfLng],
    ];

    if (selectionRectangle) {
        areaMap.removeLayer(selectionRectangle);
    }

    selectionRectangle = L.rectangle(bounds, {
        className: "sagip-rectangle",
        color: "#0284c7",
        weight: 3,
        fillColor: "#38bdf8",
        fillOpacity: 0.18,
    }).addTo(areaMap);

    selectionRectangle.on("click", () => {
        alert(`Selected SAGIP flood analysis rectangle: ${currentSizeKm} km × ${currentSizeKm} km`);
    });

    // Automatically zoom out so the full rectangle is visible.
    areaMap.fitBounds(selectionRectangle.getBounds(), {
        padding: [30, 30],
        maxZoom: 15,
    });

    updateBboxDisplay();
}

function moveRectangleToMapCenter() {
    createRectangleAtCenter(currentSizeKm);
}

function setRectangleSizeKm(sizeKm) {
    currentSizeKm = sizeKm;

    const resolutionSelect = document.getElementById("grid-resolution");

    if (resolutionSelect) {
        if (sizeKm >= 30) {
            resolutionSelect.value = "25";
        } else if (sizeKm >= 20) {
            resolutionSelect.value = "30";
        } else if (sizeKm >= 10) {
            resolutionSelect.value = "40";
        } else {
            resolutionSelect.value = "80";
        }
    }

    createRectangleAtCenter(currentSizeKm);
}

function getSelectedBbox() {
    if (!selectionRectangle) return null;

    const bounds = selectionRectangle.getBounds();

    return {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
    };
}

function updateBboxDisplay() {
    const bbox = getSelectedBbox();

    if (!bbox) return;

    document.getElementById("bbox-north").textContent = bbox.north.toFixed(6);
    document.getElementById("bbox-south").textContent = bbox.south.toFixed(6);
    document.getElementById("bbox-east").textContent = bbox.east.toFixed(6);
    document.getElementById("bbox-west").textContent = bbox.west.toFixed(6);
}

window.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("area-map")) {
        initAreaMap();
    }
});

function detectUserLocation() {
    const locationButton = document.getElementById("detect-location-btn");

    if (!navigator.geolocation) {
        alert("Your browser does not support location detection.");
        return;
    }

    if (locationButton) {
        locationButton.textContent = "📡 Detecting location...";
        locationButton.classList.add("detecting");
        locationButton.disabled = true;
    }

    navigator.geolocation.getCurrentPosition(
        function success(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = position.coords.accuracy;

            if (!areaMap) {
                alert("Map is not ready yet.");
                resetLocationButton();
                return;
            }

            areaMap.setView([lat, lng], 15);

            if (userLocationMarker) {
                areaMap.removeLayer(userLocationMarker);
            }

            if (userLocationCircle) {
                areaMap.removeLayer(userLocationCircle);
            }

            const userIcon = L.divIcon({
                className: "",
                html: `<div class="user-location-pulse"></div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9],
            });

            userLocationMarker = L.marker([lat, lng], {
                icon: userIcon,
            }).addTo(areaMap);

            userLocationMarker.bindPopup(`
        <strong>Your detected location</strong><br>
        Accuracy: around ${Math.round(accuracy)} meters
      `).openPopup();

            userLocationCircle = L.circle([lat, lng], {
                radius: accuracy,
                color: "#0284c7",
                fillColor: "#38bdf8",
                fillOpacity: 0.12,
                weight: 2,
            }).addTo(areaMap);

            createRectangleAtCenter(currentSizeKm);
            updateBboxDisplay();
            resetLocationButton();
        },

        function error(error) {
            let message = "Location detection failed.";

            if (error.code === 1) {
                message = "Location permission was denied. Please allow location access in your browser.";
            }

            if (error.code === 2) {
                message = "Your location is unavailable. Check your internet or device location settings.";
            }

            if (error.code === 3) {
                message = "Location detection timed out. Try again.";
            }

            alert(message);
            resetLocationButton();
        },

        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
        }
    );
}

function resetLocationButton() {
    const locationButton = document.getElementById("detect-location-btn");

    if (!locationButton) return;

    locationButton.textContent = "📍 Detect My Current Location";
    locationButton.classList.remove("detecting");
    locationButton.disabled = false;
}