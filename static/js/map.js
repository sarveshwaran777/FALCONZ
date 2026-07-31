/**
 * Leaflet.js GCS Satellite & High-Visibility Map Module
 * Optimized with high-contrast place labels, vehicle tracking badges, home marker & mission waypoints.
 */
class GCSMap {
    constructor(containerId) {
        this.containerId = containerId;
        this.map = null;
        this.droneMarker = null;
        this.homeMarker = null;
        this.waypointMarkers = [];
        this.missionPolyline = null;
        this.pathPolyline = null;
        this.pathCoords = [];
        this.autoCenter = true;
        this.lastLat = null;
        this.lastLon = null;
        this.homePos = null;
        this.hasFirstFix = false;
        // Default initial center: Tamil Nadu, India
        this.defaultCenter = [11.1271, 78.6569];
        this.defaultZoom = 8;
        this.init();
    }

    init() {
        const el = document.getElementById(this.containerId);
        if (!el) return;

        // Initialize Map
        this.map = L.map(this.containerId, {
            center: this.defaultCenter,
            zoom: this.defaultZoom,
            zoomControl: true,
            maxZoom: 20
        });

        setTimeout(() => {
            this.invalidateSize();
        }, 150);

        // 1. Google Satellite Hybrid (High Resolution Satellite + Prominent Place Names, Towns & Cities)
        this.googleHybridLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google Maps',
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
        });

        // 2. Esri World Imagery
        const esriSatelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 19
        });

        // 3. High Contrast Place & City Labels Overlay (CartoDB Voyager Labels)
        const placeLabelsOverlay = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CARTO &copy; OpenStreetMap',
            maxZoom: 19,
            subdomains: 'abcd'
        });

        // 4. OpenStreetMap Standard (Full Street & Town Names)
        this.osmStreetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19
        });

        // 5. Dark Vector Mode
        const darkVectorLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CARTO &copy; OpenStreetMap',
            maxZoom: 19
        });

        // Combine Esri Satellite + High Contrast CartoDB Place Labels
        const esriLabeledHybrid = L.layerGroup([esriSatelliteLayer, placeLabelsOverlay]);

        // Default to Google Hybrid (Satellite + Detailed Place Names) on startup
        this.googleHybridLayer.addTo(this.map);

        // Add Layer Control for switching map views
        const baseMaps = {
            "🛰️ Satellite + Place Names (Google)": this.googleHybridLayer,
            "🗺️ Satellite + Place Labels (Esri/Carto)": esriLabeledHybrid,
            "📍 OpenStreetMap (Full Street & Town Names)": this.osmStreetLayer,
            "🌙 Dark Vector Mode": darkVectorLayer
        };

        const overlays = {
            "🏷️ High-Contrast Place & City Labels": placeLabelsOverlay
        };

        L.control.layers(baseMaps, overlays, { position: 'topright' }).addTo(this.map);

        // Custom Productly Primary Blue Rotated Drone/Plane SVG Icon
        const droneSvg = `
            <svg width="46" height="46" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 4px 12px rgba(59,91,255,0.4));">
                <path d="M21 2L28 16L21 13L14 16L21 2Z" fill="#3B5BFF" stroke="#FFFFFF" stroke-width="2"/>
                <circle cx="21" cy="21" r="7" fill="#22C55E" stroke="#FFFFFF" stroke-width="2"/>
                <path d="M21 28L25 38L21 35L17 38L21 28Z" fill="#5C7CFA" opacity="0.9"/>
                <line x1="6" y1="21" x2="36" y2="21" stroke="#3B5BFF" stroke-width="3"/>
            </svg>
        `;

        const droneIcon = L.divIcon({
            className: 'drone-leaflet-icon',
            html: `<div id="drone-icon-wrapper" style="transform-origin: center; transition: transform 0.15s ease-out;">${droneSvg}</div>`,
            iconSize: [46, 46],
            iconAnchor: [23, 23]
        });

        this.droneMarker = L.marker([0, 0], { icon: droneIcon }).addTo(this.map);
        this.droneMarker.setOpacity(0); // Strictly hidden until telemetry connects with valid GPS fix

        // Permanent high-contrast tooltip for live drone coordinates & altitude
        this.droneMarker.bindTooltip('<div id="drone-map-badge" class="map-badge-drone"><b>DRONE</b> - STANDBY</div>', {
            permanent: true,
            direction: 'top',
            offset: [0, -22],
            className: 'custom-map-tooltip'
        });

        // Trailing flight path polyline (Productly Primary Blue)
        this.pathPolyline = L.polyline([], {
            color: '#3B5BFF',
            weight: 4,
            opacity: 0.9,
            dashArray: '6, 8'
        }).addTo(this.map);

        // Mission plan polyline (Amber Dash)
        this.missionPolyline = L.polyline([], {
            color: '#F59E0B',
            weight: 3,
            opacity: 0.85,
            dashArray: '8, 6'
        }).addTo(this.map);

        // Ensure Leaflet map bounds are correctly calculated
        setTimeout(() => {
            if (this.map) this.map.invalidateSize();
        }, 300);
    }

    update(lat, lon, heading, alt = null, isConnected = true) {
        if (!this.map) return;

        // If disconnected or invalid coordinates, hide drone marker
        if (!isConnected || lat === null || lon === null || isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) {
            this.droneMarker.setOpacity(0);
            return;
        }

        const newPos = [lat, lon];
        
        // Show drone marker
        this.droneMarker.setOpacity(1);
        this.droneMarker.setLatLng(newPos);

        // Update High-Contrast Drone Badge Content (cached to avoid Leaflet DOM thrashing)
        const hdgStr = heading !== null && heading !== undefined ? `${Math.round(heading)}°` : '—';
        const altStr = alt !== null && alt !== undefined ? `${alt.toFixed(1)}m` : '—';
        const badgeText = `🚁 <b>DRONE</b> | ALT: ${altStr} | HDG: ${hdgStr}`;
        if (this.lastBadgeText !== badgeText) {
            this.lastBadgeText = badgeText;
            this.droneMarker.setTooltipContent(`<div class="map-badge-drone">${badgeText}</div>`);
        }

        // Rotate drone SVG icon based on vehicle heading
        const iconEl = document.getElementById('drone-icon-wrapper');
        if (iconEl && heading !== null && heading !== undefined) {
            iconEl.style.transform = `rotate(${heading}deg)`;
        }

        // Set Home position on first fix
        if (!this.homePos) {
            this.setHomePosition(lat, lon);
        }

        // Deduplicate trail coordinates (only add if moved > ~0.5m)
        if (this.lastLat === null || this.lastLon === null || Math.hypot(lat - this.lastLat, lon - this.lastLon) > 0.000005) {
            this.pathCoords.push(newPos);
            if (this.pathCoords.length > 1000) {
                this.pathCoords.shift();
            }
            this.pathPolyline.setLatLngs(this.pathCoords);
            this.lastLat = lat;
            this.lastLon = lon;
        }

        // On first telemetry GPS fix, smoothly fly to live drone location at zoom 17
        if (!this.hasFirstFix) {
            this.hasFirstFix = true;
            this.map.flyTo(newPos, 17, { duration: 1.5 });
            this.map.invalidateSize();
        } else if (this.autoCenter) {
            this.map.panTo(newPos, { animate: false });
        }
    }

    setHomePosition(lat, lon) {
        if (!this.map || lat === null || lon === null) return;
        this.homePos = [lat, lon];

        const homeSvg = `
            <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 0px 8px rgba(0,255,136,0.9));">
                <circle cx="17" cy="17" r="14" fill="#0a0d14" stroke="#00ff88" stroke-width="2.5"/>
                <path d="M17 8L10 14V23H14V17H20V23H24V14L17 8Z" fill="#00ff88"/>
            </svg>
        `;
        const homeIcon = L.divIcon({
            className: 'home-leaflet-icon',
            html: `<div>${homeSvg}</div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });

        if (this.homeMarker) {
            this.homeMarker.setLatLng(this.homePos);
        } else {
            this.homeMarker = L.marker(this.homePos, { icon: homeIcon }).addTo(this.map);
            this.homeMarker.bindTooltip('<div class="map-badge-home">🏠 <b>HOME / TAKEOFF POINT</b></div>', {
                permanent: true,
                direction: 'bottom',
                offset: [0, 16],
                className: 'custom-map-tooltip'
            });
        }
    }

    updateMissionWaypoints(waypoints) {
        if (!this.map) return;

        // Clear existing waypoint markers
        this.waypointMarkers.forEach(m => this.map.removeLayer(m));
        this.waypointMarkers = [];

        if (!waypoints || waypoints.length === 0) {
            this.missionPolyline.setLatLngs([]);
            return;
        }

        const coords = [];
        waypoints.forEach((wp, idx) => {
            if (wp.lat && wp.lon && (wp.lat !== 0 || wp.lon !== 0)) {
                const pos = [wp.lat, wp.lon];
                coords.push(pos);

                const wpSvg = `
                    <div class="wp-marker-badge">WP${idx + 1}</div>
                `;
                const wpIcon = L.divIcon({
                    className: 'wp-leaflet-icon',
                    html: wpSvg,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });

                const marker = L.marker(pos, { icon: wpIcon }).addTo(this.map);
                marker.bindTooltip(`<div class="map-badge-wp">📍 <b>WAYPOINT #${idx + 1}</b><br>Alt: ${wp.alt}m</div>`, {
                    permanent: false,
                    direction: 'top',
                    className: 'custom-map-tooltip'
                });
                this.waypointMarkers.push(marker);
            }
        });

        this.missionPolyline.setLatLngs(coords);
    }

    resetToDefaultView() {
        this.hasFirstFix = false;
        this.droneMarker.setOpacity(0);
        if (this.map) {
            this.map.setView(this.defaultCenter, this.defaultZoom, { animate: true });
        }
    }

    invalidateSize() {
        if (this.map) {
            this.map.invalidateSize();
        }
    }

    clearTrail() {
        this.pathCoords = [];
        if (this.pathPolyline) {
            this.pathPolyline.setLatLngs([]);
        }
        this.lastLat = null;
        this.lastLon = null;
    }

    toggleAutoCenter() {
        this.autoCenter = !this.autoCenter;
        if (this.autoCenter && this.map) {
            if (this.lastLat !== null && this.lastLon !== null && !isNaN(this.lastLat)) {
                this.map.flyTo([this.lastLat, this.lastLon], Math.max(this.map.getZoom(), 16), { duration: 1.2 });
            } else if (this.homePos) {
                this.map.flyTo(this.homePos, Math.max(this.map.getZoom(), 16), { duration: 1.2 });
            } else {
                this.map.setView(this.defaultCenter, this.defaultZoom, { animate: true });
            }
        }
        return this.autoCenter;
    }

    setSatelliteMode() {
        if (!this.map) return;
        if (this.osmStreetLayer && this.map.hasLayer(this.osmStreetLayer)) {
            this.map.removeLayer(this.osmStreetLayer);
        }
        if (this.googleHybridLayer) {
            this.googleHybridLayer.addTo(this.map);
        }
    }

    setStreetMode() {
        if (!this.map) return;
        if (this.googleHybridLayer && this.map.hasLayer(this.googleHybridLayer)) {
            this.map.removeLayer(this.googleHybridLayer);
        }
        if (this.osmStreetLayer) {
            this.osmStreetLayer.addTo(this.map);
        }
    }
}
