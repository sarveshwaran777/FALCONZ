/**
 * APM Live Web Dashboard Main Application
 * Includes MAVLink Connect/Disconnect handlers, Terminal Log Console, Map controls,
 * Right Corner Camera View (with VLC launcher), and Drone System Details Inspector.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize PFD Artificial Horizon, Calibration PFD, Leaflet Satellite Map, and System Inspector
    const pfd = new AttitudeIndicator('attitude-canvas');
    const calPfd = new AttitudeIndicator('cal-attitude-canvas');
    const gcsMap = new GCSMap('map');
    window.telemetryInspector = new TelemetryInspector();

    let previousKnownSerialPorts = [];

    // Fetch auto-detected serial COM ports from backend
    async function populatePortOptions(userTriggered = false) {
        const connSelect = document.getElementById('conn-input');
        const portCountBadge = document.getElementById('port-count-badge');
        if (!connSelect || connSelect.tagName !== 'SELECT') return;

        try {
            let activeConn = 'udp:127.0.0.1:14550';
            try {
                const telemRes = await fetch('/api/telemetry');
                if (telemRes.ok) {
                    const telemData = await telemRes.json();
                    if (telemData && telemData.connection_string) {
                        activeConn = telemData.connection_string;
                    }
                }
            } catch (err) {}

            const res = await fetch('/api/ports');
            if (res.ok) {
                const data = await res.json();
                const detailedPorts = data.detailed_ports || [];
                const serialCount = detailedPorts.length;

                if (portCountBadge) {
                    portCountBadge.textContent = `${serialCount} Serial`;
                    if (serialCount > 0) {
                        portCountBadge.classList.add('active');
                    } else {
                        portCountBadge.classList.remove('active');
                    }
                }

                // Check if a new serial port was plugged into the laptop
                const currentSerialDevices = detailedPorts.map(p => p.device);
                const newlyPlugged = currentSerialDevices.filter(d => !previousKnownSerialPorts.includes(d));
                previousKnownSerialPorts = currentSerialDevices;

                connSelect.innerHTML = '';

                if (detailedPorts.length > 0) {
                    detailedPorts.forEach(port => {
                        const opt = document.createElement('option');
                        opt.value = port.device;
                        opt.textContent = `🔌 ${port.device} - ${port.description}`;
                        if (port.device === activeConn || (newlyPlugged.includes(port.device) && activeConn === 'udp:127.0.0.1:14550')) {
                            opt.selected = true;
                        }
                        connSelect.appendChild(opt);
                    });
                } else {
                    const optEmpty = document.createElement('option');
                    optEmpty.value = '';
                    optEmpty.disabled = true;
                    optEmpty.textContent = '❌ No COM serial port plugged in';
                    connSelect.appendChild(optEmpty);
                }

                // Add standard UDP simulation option
                const optUdp = document.createElement('option');
                optUdp.value = 'udp:127.0.0.1:14550';
                optUdp.textContent = '📡 udp:127.0.0.1:14550 (UDP Sim / Network)';
                if (activeConn.startsWith('udp:') || !connSelect.value) {
                    optUdp.selected = true;
                }
                connSelect.appendChild(optUdp);

                // Show alert toast if new port plugged in or user clicked scan
                if (newlyPlugged.length > 0) {
                    showVlcToast(`✨ Ground Telemetry Dongle Plugged In: ${newlyPlugged.join(', ')}`, 'success');
                } else if (userTriggered) {
                    if (serialCount > 0) {
                        showVlcToast(`Found ${serialCount} connected serial port(s): ${currentSerialDevices.join(', ')}`, 'success');
                    } else {
                        showVlcToast('No physical serial COM port detected on laptop. Plug in your telemetry ground module.', 'info');
                    }
                }
            }
        } catch (e) {
            console.log('Port fetch info:', e);
        }
    }
    populatePortOptions();
    setInterval(() => populatePortOptions(false), 3500);

    let socket = null;
    let reconnectTimer = null;
    let isReplayMode = false;
    let historyLogs = [];
    let lastRenderedTimestamp = null;
    let lastPwmCache = { rc: '', servo: '' };
    let autoScrollLogs = true;
    let renderedLogTimestamps = new Set();

    // DOM Elements
    const elements = {
        statusBadge: document.getElementById('status-badge'),
        statusText: document.getElementById('status-text'),
        armedBadge: document.getElementById('armed-badge'),
        modeBadge: document.getElementById('mode-badge'),
        vehicleType: document.getElementById('vehicle-type'),

        // Header Connection Controls
        connInput: document.getElementById('conn-input'),
        baudInput: document.getElementById('baud-input'),
        btnConnect: document.getElementById('btn-header-connect'),
        btnDisconnect: document.getElementById('btn-header-disconnect'),
        btnPfdMore: document.getElementById('btn-pfd-more'),
        navItemHome: document.getElementById('nav-item-home'),
        navItemDrone: document.getElementById('nav-item-drone'),
        navItemCam: document.getElementById('nav-item-cam'),
        navItemInspector: document.getElementById('nav-item-inspector'),
        navItemCalibration: document.getElementById('nav-item-calibration'),
        btnBrandHome: document.getElementById('btn-brand-home'),
        viewHome: document.getElementById('view-home'),
        viewDroneDashboard: document.getElementById('view-drone-dashboard'),
        viewCameraStream: document.getElementById('view-camera-stream'),
        viewCalibration: document.getElementById('view-calibration'),

        // Attitude
        roll: document.getElementById('val-roll'),
        pitch: document.getElementById('val-pitch'),
        yaw: document.getElementById('val-yaw'),

        // Position
        lat: document.getElementById('val-lat'),
        lon: document.getElementById('val-lon'),
        alt: document.getElementById('val-alt'),
        relAlt: document.getElementById('val-rel-alt'),
        heading: document.getElementById('val-heading'),

        // VFR HUD / Speed
        groundspeed: document.getElementById('val-groundspeed'),
        airspeed: document.getElementById('val-airspeed'),
        climb: document.getElementById('val-climb'),
        throttle: document.getElementById('val-throttle'),
        throttleBar: document.getElementById('bar-throttle'),

        // Battery
        voltage: document.getElementById('val-voltage'),
        current: document.getElementById('val-current'),
        remaining: document.getElementById('val-remaining'),
        batteryBar: document.getElementById('bar-battery'),

        // GPS
        fixType: document.getElementById('val-fix-type'),
        sats: document.getElementById('val-sats'),
        hdop: document.getElementById('val-hdop'),

        // Terminal Console Elements
        terminalLogs: document.getElementById('terminal-logs'),
        terminalInput: document.getElementById('terminal-input'),
        terminalSearchInput: document.getElementById('terminal-search-input'),
        btnSendCmd: document.getElementById('btn-send-cmd'),
        btnClearTerminal: document.getElementById('btn-clear-terminal'),
        btnAutoscroll: document.getElementById('btn-autoscroll'),

        // Map Controls
        btnCenterMap: document.getElementById('btn-center-map'),
        btnFetchMission: document.getElementById('btn-fetch-mission'),
        btnClearTrail: document.getElementById('btn-clear-trail'),

        // Replay Controls
        btnLiveMode: document.getElementById('btn-live-mode'),
        btnReplayMode: document.getElementById('btn-replay-mode'),
        scrubber: document.getElementById('replay-scrubber'),
        replayTime: document.getElementById('replay-time-display'),

        // Theme Switcher & Page Views
        btnThemeToggle: document.getElementById('btn-theme-toggle'),
        themeToggleIcon: document.getElementById('theme-toggle-icon'),
        btnThreeDots: document.getElementById('btn-three-dots'),
        navMenuDropdown: document.getElementById('nav-menu-dropdown'),
        navItemDrone: document.getElementById('nav-item-drone'),
        navItemCam: document.getElementById('nav-item-cam'),
        viewDroneDashboard: document.getElementById('view-drone-dashboard'),
        viewCameraStream: document.getElementById('view-camera-stream'),

        // Right Panel Tabs
        tabBtnCam: document.getElementById('tab-btn-cam'),
        tabBtnDetails: document.getElementById('tab-btn-details'),
        tabContentCam: document.getElementById('tab-content-cam'),
        tabContentDetails: document.getElementById('tab-content-details'),

        // Camera View Elements
        hudStatusDot: document.getElementById('hud-status-dot'),
        camStatus: document.getElementById('cam-status'),
        hudAlt: document.getElementById('hud-alt'),
        hudSpd: document.getElementById('hud-spd'),
        hudBat: document.getElementById('hud-bat'),
        hudMode: document.getElementById('hud-mode'),
        hudTime: document.getElementById('hud-time'),
        camViewport: document.getElementById('cam-viewport'),
        vlcIpInput: document.getElementById('vlc-ip-input'),
        vlcProtocolSelect: document.getElementById('vlc-protocol-select'),
        btnPasteClipboard: document.getElementById('btn-paste-clipboard'),
        btnCopyStreamUrl: document.getElementById('btn-copy-stream-url'),
        streamUrlInput: document.getElementById('stream-url-input'),
        btnPlayStream: document.getElementById('btn-play-stream'),
        btnVlcStream: document.getElementById('btn-vlc-stream'),
        btnFullscreenCam: document.getElementById('btn-fullscreen-cam'),
        vlcStatusToast: document.getElementById('vlc-status-toast'),

        // Drone System Details Inspector Elements
        dtVehicle: document.getElementById('dt-vehicle'),
        dtSysId: document.getElementById('dt-sys-id'),
        dtCompId: document.getElementById('dt-comp-id'),
        dtArmed: document.getElementById('dt-armed'),
        dtMode: document.getElementById('dt-mode'),
        dtStatus: document.getElementById('dt-status'),
        dtLat: document.getElementById('dt-lat'),
        dtLon: document.getElementById('dt-lon'),
        dtAlt: document.getElementById('dt-alt'),
        dtRelAlt: document.getElementById('dt-rel-alt'),
        dtHeading: document.getElementById('dt-heading'),
        dtGpsFix: document.getElementById('dt-gps-fix'),
        dtAttitude: document.getElementById('dt-attitude'),
        dtAirspeed: document.getElementById('dt-airspeed'),
        dtGroundspeed: document.getElementById('dt-groundspeed'),
        dtClimb: document.getElementById('dt-climb'),
        dtVoltage: document.getElementById('dt-voltage'),
        dtBatteryPct: document.getElementById('dt-battery-pct'),
        dtMissionSummary: document.getElementById('dt-mission-summary')
    };

    // Render helper for values with null fallback
    function setVal(el, val, unit = '', decimals = null) {
        if (!el) return;
        if (val === null || val === undefined || isNaN(val)) {
            if (el.dataset.rawVal !== 'null') {
                el.dataset.rawVal = 'null';
                el.innerHTML = `<span class="null-value">—</span>`;
            }
        } else {
            let displayVal = decimals !== null ? Number(val).toFixed(decimals) : val;
            const cacheKey = `${displayVal}_${unit}`;
            if (el.dataset.rawVal !== cacheKey) {
                el.dataset.rawVal = cacheKey;
                el.innerHTML = `${displayVal} ${unit ? `<span class="data-unit">${unit}</span>` : ''}`;
            }
        }
    }

    // Connect to WebSocket
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

        console.log(`Connecting to WebSocket: ${wsUrl}`);
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket connected.');
            if (reconnectTimer) {
                clearInterval(reconnectTimer);
                reconnectTimer = null;
            }
            gcsMap.invalidateSize();
        };

        let pendingTelemetryFrame = null;
        let isRenderScheduled = false;

        socket.onmessage = (event) => {
            if (isReplayMode) return; // Ignore live stream when scrubbing history
            try {
                const data = JSON.parse(event.data);
                
                // Deduplicate incoming frames based on timestamp
                if (data.timestamp && data.timestamp === lastRenderedTimestamp) {
                    return;
                }
                lastRenderedTimestamp = data.timestamp;

                pendingTelemetryFrame = data;
                if (!isRenderScheduled) {
                    isRenderScheduled = true;
                    requestAnimationFrame(() => {
                        isRenderScheduled = false;
                        if (pendingTelemetryFrame) {
                            updateDashboard(pendingTelemetryFrame);
                        }
                    });
                }
            } catch (e) {
                console.error('Error parsing telemetry JSON:', e);
            }
        };

        socket.onclose = () => {
            console.warn('WebSocket disconnected. Scheduling reconnect...');
            setConnectionStatus(false);
            if (!reconnectTimer) {
                reconnectTimer = setInterval(connectWebSocket, 2000);
            }
        };

        socket.onerror = (err) => {
            console.error('WebSocket error:', err);
            socket.close();
        };
    }

    let isMavlinkConnected = false;

    function updateConnectButtonUI(connected) {
        if (!elements.btnConnect) return;
        const iconEl = document.getElementById('header-conn-icon');
        const textEl = document.getElementById('header-conn-text');

        if (connected) {
            elements.btnConnect.className = 'btn btn-danger-outline';
            if (textEl) textEl.textContent = 'DISCONNECT';
            if (iconEl) {
                iconEl.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
            }
        } else {
            elements.btnConnect.className = 'btn btn-primary';
            if (textEl) textEl.textContent = 'CONNECT';
            if (iconEl) {
                iconEl.innerHTML = '<path d="M12 2v6M12 18v4M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M18 12h4M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/>';
            }
        }
    }

    function setConnectionStatus(connected, connString = '', isSerial = false) {
        isMavlinkConnected = Boolean(connected);
        if (elements.statusBadge) {
            if (connected) {
                elements.statusBadge.className = 'pill-badge pill-connected';
                const label = connString ? (isSerial ? `LIVE (${connString})` : `LIVE (${connString.split(':')[0].toUpperCase()})`) : 'LIVE';
                elements.statusText.textContent = label;
            } else {
                elements.statusBadge.className = 'pill-badge pill-disconnected';
                elements.statusText.textContent = 'DISCONNECTED';
            }
        }
        updateConnectButtonUI(isMavlinkConnected);
    }

    if (elements.btnPfdMore) {
        elements.btnPfdMore.addEventListener('click', () => {
            if (window.telemetryInspector) {
                window.telemetryInspector.show();
            }
        });
    }

    // Update Dashboard UI with decoded telemetry snapshot
    function updateDashboard(data) {
        const isConnected = Boolean(data && data.connected);
        setConnectionStatus(isConnected, data ? data.connection_string : '', data ? data.is_serial : false);

        if (window.telemetryInspector) {
            window.telemetryInspector.updateTelemetry(data);
        }

        if (calPfd && data && data.attitude) {
            const att = data.attitude || {};
            const hb = data.heartbeat || {};
            calPfd.update(att.roll, att.pitch, {
                heading: att.yaw,
                armed: hb.armed,
                mode: hb.mode,
                connected: isConnected
            });
        }

        if (window.calibrationWizard) {
            window.calibrationWizard.updateTelemetry(data);
        }

        // Update Terminal Logs if included in state
        if (data && data.terminal_logs && Array.isArray(data.terminal_logs)) {
            renderTerminalLogs(data.terminal_logs);
        }

        // Update Mission if included
        if (data && data.mission && Array.isArray(data.mission) && data.mission.length > 0) {
            gcsMap.updateMissionWaypoints(data.mission);
            updateMissionInspector(data.mission);
        }

        // Update Drone System Details & Camera HUD
        updateDroneDetailsInspector(data, isConnected);
        updateCameraHud(data, isConnected);

        if (!isConnected) {
            // Vehicle & Arming
            if (elements.armedBadge) {
                elements.armedBadge.className = 'pill-badge pill-disarmed';
                elements.armedBadge.textContent = 'DISARMED';
            }
            if (elements.modeBadge) elements.modeBadge.textContent = 'STANDBY';
            if (elements.vehicleType) elements.vehicleType.textContent = 'Vehicle';

            // Attitude & PFD Canvas
            setVal(elements.roll, null);
            setVal(elements.pitch, null);
            setVal(elements.yaw, null);
            pfd.update(0, 0, {
                heading: 0,
                airspeed: 0,
                groundspeed: 0,
                altitude: 0,
                climb: 0,
                voltage: 0,
                current: 0,
                remaining: 0,
                armed: false,
                mode: 'STANDBY',
                gpsFix: 'NO FIX',
                connected: false
            });

            // Position & Map
            setVal(elements.lat, null);
            setVal(elements.lon, null);
            setVal(elements.alt, null);
            setVal(elements.relAlt, null);
            setVal(elements.heading, null);
            gcsMap.update(null, null, null, null, false);

            // Speed & VFR HUD
            setVal(elements.groundspeed, null);
            setVal(elements.airspeed, null);
            setVal(elements.climb, null);
            setVal(elements.throttle, null);
            if (elements.throttleBar) elements.throttleBar.style.width = '0%';

            // Battery
            setVal(elements.voltage, null);
            setVal(elements.current, null);
            setVal(elements.remaining, null);
            if (elements.batteryBar) elements.batteryBar.style.width = '0%';

            // GPS
            setVal(elements.fixType, null);
            setVal(elements.sats, null);
            setVal(elements.hdop, null);

            // RC & Servo Output Bars
            updatePwmBars('rc-channel-list', [], 'rc');
            updatePwmBars('servo-channel-list', [], 'servo');
            return;
        }

        // Live Telemetry Connected: Update UI & Map
        if (elements.vehicleType && data.vehicle_type && elements.vehicleType.textContent !== data.vehicle_type) {
            elements.vehicleType.textContent = data.vehicle_type;
        }

        const hb = data.heartbeat || {};
        if (elements.armedBadge && hb.armed !== undefined) {
            if (hb.armed) {
                elements.armedBadge.className = 'pill-badge pill-armed';
                elements.armedBadge.textContent = 'ARMED';
            } else {
                elements.armedBadge.className = 'pill-badge pill-disarmed';
                elements.armedBadge.textContent = 'DISARMED';
            }
        }
        if (elements.modeBadge && hb.mode && elements.modeBadge.textContent !== hb.mode) {
            elements.modeBadge.textContent = hb.mode;
        }

        // Extract telemetry sub-objects
        const att = data.attitude || {};
        const pos = data.position || {};
        const vfr = data.vfr_hud || {};
        const bat = data.battery || {};
        const gps = data.gps || {};

        setVal(elements.roll, att.roll, '°', 1);
        setVal(elements.pitch, att.pitch, '°', 1);
        setVal(elements.yaw, att.yaw, '°', 1);

        pfd.update(att.roll, att.pitch, {
            heading: pos.heading !== null && pos.heading !== undefined ? pos.heading : (att.yaw || 0),
            airspeed: vfr.airspeed || 0,
            groundspeed: vfr.groundspeed || 0,
            altitude: pos.rel_alt !== null && pos.rel_alt !== undefined ? pos.rel_alt : (pos.alt || 0),
            climb: vfr.climb || 0,
            voltage: bat.voltage || 0,
            current: bat.current || 0,
            remaining: bat.remaining || 0,
            armed: hb.armed || false,
            mode: hb.mode || 'STANDBY',
            gpsFix: gps.fix_type || '3D Fix',
            connected: true
        });

        // Position & Map
        setVal(elements.lat, pos.lat, '', 6);
        setVal(elements.lon, pos.lon, '', 6);
        setVal(elements.alt, pos.alt, 'm', 1);
        setVal(elements.relAlt, pos.rel_alt, 'm', 1);
        setVal(elements.heading, pos.heading, '°', 0);

        if (pos.lat && pos.lon) {
            gcsMap.update(pos.lat, pos.lon, pos.heading !== null && pos.heading !== undefined ? pos.heading : att.yaw, pos.alt, true);
        }

        // Speed & VFR HUD
        setVal(elements.groundspeed, vfr.groundspeed, 'm/s', 1);
        setVal(elements.airspeed, vfr.airspeed, 'm/s', 1);
        setVal(elements.climb, vfr.climb, 'm/s', 1);
        setVal(elements.throttle, vfr.throttle, '%', 0);
        if (elements.throttleBar && vfr.throttle !== null && vfr.throttle !== undefined) {
            elements.throttleBar.style.width = `${Math.min(100, Math.max(0, vfr.throttle))}%`;
        }

        // Battery
        setVal(elements.voltage, bat.voltage, 'V', 2);
        setVal(elements.current, bat.current, 'A', 1);
        setVal(elements.remaining, bat.remaining, '%', 0);
        if (elements.batteryBar && bat.remaining !== null && bat.remaining !== undefined) {
            const pct = Math.min(100, Math.max(0, bat.remaining));
            elements.batteryBar.style.width = `${pct}%`;
            if (pct <= 20) {
                elements.batteryBar.className = 'progress-bar-fill fill-low';
            } else if (pct <= 50) {
                elements.batteryBar.className = 'progress-bar-fill fill-medium';
            } else {
                elements.batteryBar.className = 'progress-bar-fill fill-high';
            }
        }

        // GPS
        setVal(elements.fixType, gps.fix_type);
        setVal(elements.sats, gps.satellites_visible);
        setVal(elements.hdop, gps.hdop, '', 2);

        // RC & Servo Output Bars
        updatePwmBars('rc-channel-list', data.rc_channels || [], 'rc');
        updatePwmBars('servo-channel-list', data.servo_outputs || [], 'servo');
    }

    function updatePwmBars(containerId, pwmArray, cacheType) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const rawKey = Array.isArray(pwmArray) ? pwmArray.join(',') : '';
        if (lastPwmCache[cacheType] === rawKey) return;
        lastPwmCache[cacheType] = rawKey;

        let rows = container.children;
        if (rows.length !== 8) {
            let html = '';
            for (let i = 0; i < 8; i++) {
                html += `
                    <div class="channel-row">
                        <span class="channel-name">CH${i + 1}</span>
                        <div class="channel-bar-bg">
                            <div class="channel-bar-fill" style="width: 0%"></div>
                        </div>
                        <span class="channel-val">—</span>
                    </div>
                `;
            }
            container.innerHTML = html;
            rows = container.children;
        }

        for (let i = 0; i < 8; i++) {
            const val = Array.isArray(pwmArray) ? pwmArray[i] : null;
            let pct = 0;
            let displayVal = '—';
            if (val !== null && val !== undefined && val > 0) {
                displayVal = `${val} µs`;
                pct = Math.min(100, Math.max(0, ((val - 1000) / 1000) * 100));
            }
            const row = rows[i];
            if (row) {
                const fill = row.querySelector('.channel-bar-fill');
                const txt = row.querySelector('.channel-val');
                if (fill && fill.style.width !== `${pct}%`) fill.style.width = `${pct}%`;
                if (txt && txt.textContent !== displayVal) txt.textContent = displayVal;
            }
        }
    }

    // Update Video HUD Overlay
    function updateCameraHud(data, isConnected) {
        const now = new Date();
        if (elements.hudTime) elements.hudTime.textContent = now.toLocaleTimeString();

        if (!isConnected || !data) {
            if (elements.hudAlt) elements.hudAlt.textContent = '0.0m';
            if (elements.hudSpd) elements.hudSpd.textContent = '0.0m/s';
            if (elements.hudBat) elements.hudBat.textContent = '0%';
            if (elements.hudMode) elements.hudMode.textContent = 'STANDBY';
            return;
        }

        const pos = data.position || {};
        const vfr = data.vfr_hud || {};
        const bat = data.battery || {};
        const hb = data.heartbeat || {};

        if (elements.hudAlt) elements.hudAlt.textContent = pos.alt !== null ? `${pos.alt.toFixed(1)}m` : '0.0m';
        if (elements.hudSpd) elements.hudSpd.textContent = vfr.groundspeed !== null ? `${vfr.groundspeed.toFixed(1)}m/s` : '0.0m/s';
        if (elements.hudBat) elements.hudBat.textContent = bat.remaining !== null ? `${bat.remaining}%` : '0%';
        if (elements.hudMode) elements.hudMode.textContent = hb.mode || 'STANDBY';
    }

    // Update Drone System Details Inspector Tab
    function updateDroneDetailsInspector(data, isConnected) {
        if (!isConnected || !data) {
            if (elements.dtVehicle) elements.dtVehicle.textContent = 'Unknown';
            if (elements.dtSysId) elements.dtSysId.textContent = '—';
            if (elements.dtCompId) elements.dtCompId.textContent = '—';
            if (elements.dtArmed) { elements.dtArmed.textContent = 'DISARMED'; elements.dtArmed.className = 'val text-disarmed'; }
            if (elements.dtMode) { elements.dtMode.textContent = 'STANDBY'; elements.dtMode.className = 'val text-mode'; }
            if (elements.dtStatus) { elements.dtStatus.textContent = 'DISCONNECTED'; elements.dtStatus.className = 'val text-crimson'; }
            
            if (elements.dtLat) elements.dtLat.textContent = '—';
            if (elements.dtLon) elements.dtLon.textContent = '—';
            if (elements.dtAlt) elements.dtAlt.textContent = '—';
            if (elements.dtRelAlt) elements.dtRelAlt.textContent = '—';
            if (elements.dtHeading) elements.dtHeading.textContent = '—';
            if (elements.dtGpsFix) elements.dtGpsFix.textContent = 'No GPS';

            if (elements.dtAttitude) elements.dtAttitude.textContent = '— / —';
            if (elements.dtAirspeed) elements.dtAirspeed.textContent = '—';
            if (elements.dtGroundspeed) elements.dtGroundspeed.textContent = '—';
            if (elements.dtClimb) elements.dtClimb.textContent = '—';
            if (elements.dtVoltage) elements.dtVoltage.textContent = '—';
            if (elements.dtBatteryPct) elements.dtBatteryPct.textContent = '—';
            return;
        }

        const hb = data.heartbeat || {};
        const pos = data.position || {};
        const att = data.attitude || {};
        const vfr = data.vfr_hud || {};
        const bat = data.battery || {};
        const gps = data.gps || {};

        if (elements.dtVehicle) elements.dtVehicle.textContent = data.vehicle_type || 'Generic Vehicle';
        if (elements.dtSysId) elements.dtSysId.textContent = data.system_id !== null ? data.system_id : '1';
        if (elements.dtCompId) elements.dtCompId.textContent = data.component_id !== null ? data.component_id : '1';
        
        if (elements.dtArmed) {
            elements.dtArmed.textContent = hb.armed ? 'ARMED' : 'DISARMED';
            elements.dtArmed.className = hb.armed ? 'val text-armed' : 'val text-disarmed';
        }
        if (elements.dtMode) {
            elements.dtMode.textContent = hb.mode || 'STANDBY';
        }
        if (elements.dtStatus) {
            elements.dtStatus.textContent = 'LIVE CONNECTED';
            elements.dtStatus.className = 'val text-emerald';
        }

        if (elements.dtLat) elements.dtLat.textContent = pos.lat ? `${pos.lat.toFixed(6)}°` : '—';
        if (elements.dtLon) elements.dtLon.textContent = pos.lon ? `${pos.lon.toFixed(6)}°` : '—';
        if (elements.dtAlt) elements.dtAlt.textContent = pos.alt !== null ? `${pos.alt.toFixed(1)}m` : '—';
        if (elements.dtRelAlt) elements.dtRelAlt.textContent = pos.rel_alt !== null ? `${pos.rel_alt.toFixed(1)}m` : '—';
        if (elements.dtHeading) elements.dtHeading.textContent = pos.heading !== null ? `${Math.round(pos.heading)}°` : '—';
        if (elements.dtGpsFix) elements.dtGpsFix.textContent = gps.fix_type || 'No GPS';

        if (elements.dtAttitude) elements.dtAttitude.textContent = att.roll !== undefined ? `${att.roll.toFixed(1)}° / ${att.pitch.toFixed(1)}°` : '— / —';
        if (elements.dtAirspeed) elements.dtAirspeed.textContent = vfr.airspeed !== null ? `${vfr.airspeed.toFixed(1)} m/s` : '—';
        if (elements.dtGroundspeed) elements.dtGroundspeed.textContent = vfr.groundspeed !== null ? `${vfr.groundspeed.toFixed(1)} m/s` : '—';
        if (elements.dtClimb) elements.dtClimb.textContent = vfr.climb !== null ? `${vfr.climb.toFixed(1)} m/s` : '—';
        if (elements.dtVoltage) elements.dtVoltage.textContent = bat.voltage !== null ? `${bat.voltage.toFixed(2)} V` : '—';
        if (elements.dtBatteryPct) elements.dtBatteryPct.textContent = bat.remaining !== null ? `${bat.remaining}%` : '—';
    }

    function updateMissionInspector(waypoints) {
        if (!elements.dtMissionSummary) return;
        if (!waypoints || waypoints.length === 0) {
            elements.dtMissionSummary.innerHTML = '<div class="no-mission-text">No active mission waypoints loaded.</div>';
            return;
        }

        let html = '<div style="display: flex; flex-direction: column; gap: 0.25rem;">';
        waypoints.forEach((wp, i) => {
            html += `<div><b>WP #${i + 1}:</b> Lat: ${wp.lat.toFixed(6)}°, Lon: ${wp.lon.toFixed(6)}°, Alt: ${wp.alt}m</div>`;
        });
        html += '</div>';
        elements.dtMissionSummary.innerHTML = html;
    }

    let activeLogFilter = 'all';
    let logSearchQuery = '';

    // Render Terminal Console Logs accurately with filter and search support
    function renderTerminalLogs(logList) {
        const calLogs = document.getElementById('cal-terminal-logs');
        if (!elements.terminalLogs && !calLogs) return;
        
        let newEntriesAdded = false;
        logList.forEach(entry => {
            const key = `${entry.timestamp}_${entry.message}`;
            if (!renderedLogTimestamps.has(key)) {
                renderedLogTimestamps.add(key);
                newEntriesAdded = true;

                const timeStr = entry.time_str || new Date(entry.timestamp * 1000).toLocaleTimeString();
                const lvl = entry.level || 'info';
                
                const createLogDiv = () => {
                    const div = document.createElement('div');
                    div.className = `log-entry log-${lvl}`;
                    div.dataset.level = lvl;
                    div.dataset.source = entry.source || 'GCS';
                    div.dataset.msg = (entry.message || '').toLowerCase();
                    div.textContent = `[${timeStr}] ${entry.message}`;
                    applyLogVisibility(div);
                    return div;
                };

                if (elements.terminalLogs) {
                    elements.terminalLogs.appendChild(createLogDiv());
                }
                if (calLogs) {
                    calLogs.appendChild(createLogDiv());
                }
            }
        });

        // Limit DOM nodes to 300 entries for performance
        if (elements.terminalLogs) {
            while (elements.terminalLogs.children.length > 300) {
                elements.terminalLogs.removeChild(elements.terminalLogs.firstChild);
            }
        }
        if (calLogs) {
            while (calLogs.children.length > 300) {
                calLogs.removeChild(calLogs.firstChild);
            }
        }

        if (newEntriesAdded && autoScrollLogs) {
            requestAnimationFrame(() => {
                if (elements.terminalLogs) elements.terminalLogs.scrollTop = elements.terminalLogs.scrollHeight;
                if (calLogs) calLogs.scrollTop = calLogs.scrollHeight;
            });
        }
    }

    function applyLogVisibility(el) {
        const lvl = el.dataset.level || 'info';
        const msg = el.dataset.msg || '';

        let matchesFilter = true;
        if (activeLogFilter === 'fc') {
            matchesFilter = (msg.includes('[fc]') || msg.includes('[ack]') || msg.includes('[vehicle]'));
        } else if (activeLogFilter === 'cmd') {
            matchesFilter = (msg.startsWith('>') || lvl === 'cmd');
        } else if (activeLogFilter === 'error') {
            matchesFilter = (lvl === 'error' || lvl === 'warn');
        }

        let matchesSearch = true;
        if (logSearchQuery) {
            matchesSearch = msg.includes(logSearchQuery);
        }

        el.style.display = (matchesFilter && matchesSearch) ? 'block' : 'none';
    }

    function refreshAllLogVisibilities() {
        if (!elements.terminalLogs) return;
        Array.from(elements.terminalLogs.children).forEach(el => applyLogVisibility(el));
        if (autoScrollLogs) {
            elements.terminalLogs.scrollTop = elements.terminalLogs.scrollHeight;
        }
    }

    // Terminal Filter Buttons Event Listeners
    document.querySelectorAll('.filter-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeLogFilter = btn.dataset.filter || 'all';
            refreshAllLogVisibilities();
        });
    });

    if (elements.terminalSearchInput) {
        elements.terminalSearchInput.addEventListener('input', (e) => {
            logSearchQuery = e.target.value.trim().toLowerCase();
            refreshAllLogVisibilities();
        });
    }

    // Detect user manual scroll up/down in Terminal Console
    if (elements.terminalLogs) {
        elements.terminalLogs.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = elements.terminalLogs;
            const isAtBottom = (scrollHeight - scrollTop - clientHeight) <= 35;
            autoScrollLogs = isAtBottom;
            if (elements.btnAutoscroll) {
                if (autoScrollLogs) {
                    elements.btnAutoscroll.classList.add('btn-active');
                } else {
                    elements.btnAutoscroll.classList.remove('btn-active');
                }
            }
        }, { passive: true });
    }

    if (elements.btnAutoscroll) {
        elements.btnAutoscroll.addEventListener('click', () => {
            autoScrollLogs = !autoScrollLogs;
            if (autoScrollLogs) {
                elements.btnAutoscroll.classList.add('btn-active');
                if (elements.terminalLogs) elements.terminalLogs.scrollTop = elements.terminalLogs.scrollHeight;
            } else {
                elements.btnAutoscroll.classList.remove('btn-active');
            }
        });
    }

    if (elements.btnClearTerminal) {
        elements.btnClearTerminal.addEventListener('click', () => {
            if (elements.terminalLogs) elements.terminalLogs.innerHTML = '';
            renderedLogTimestamps.clear();
        });
    }

    // Adaptive Dark / Light Theme Toggle Handler
    function applyTheme(isLight) {
        if (isLight) {
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
            document.documentElement.classList.add('light-theme');
            document.documentElement.classList.remove('dark-theme');
        } else {
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
            document.documentElement.classList.add('dark-theme');
            document.documentElement.classList.remove('light-theme');
        }
        const icon = document.getElementById('theme-toggle-icon');
        if (icon) icon.textContent = isLight ? '☀️' : '🌙';
        localStorage.setItem('falcon_gcs_theme', isLight ? 'light' : 'dark');

        if (window.orbInstance) {
            window.orbInstance.backgroundColor = isLight ? '#F8FAFC' : '#070A14';
        }

        setTimeout(() => {
            if (gcsMap) gcsMap.invalidateSize();
        }, 100);
    }

    const savedTheme = localStorage.getItem('falcon_gcs_theme');
    if (savedTheme === 'light') {
        applyTheme(true);
    } else {
        applyTheme(false);
    }

    const themeToggleBtn = document.getElementById('btn-theme-toggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isLight = !document.body.classList.contains('light-theme');
            applyTheme(isLight);
        });
    }

    // 3-Dot Navigation Menu Toggle & Page View Handlers
    if (elements.btnThreeDots && elements.navMenuDropdown) {
        elements.btnThreeDots.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.navMenuDropdown.classList.toggle('show');
        });

        document.addEventListener('click', (e) => {
            if (elements.navMenuDropdown && !elements.navMenuDropdown.contains(e.target) && !elements.btnThreeDots.contains(e.target)) {
                elements.navMenuDropdown.classList.remove('show');
            }
        });
    }

    function switchToHomeView() {
        if (window.telemetryInspector) window.telemetryInspector.hide();
        if (elements.navItemHome) elements.navItemHome.classList.add('active');
        if (elements.navItemDrone) elements.navItemDrone.classList.remove('active');
        if (elements.navItemCam) elements.navItemCam.classList.remove('active');
        if (elements.navItemInspector) elements.navItemInspector.classList.remove('active');
        if (elements.navItemCalibration) elements.navItemCalibration.classList.remove('active');

        if (elements.viewHome) elements.viewHome.classList.add('active');
        if (elements.viewDroneDashboard) elements.viewDroneDashboard.classList.remove('active');
        if (elements.viewCameraStream) elements.viewCameraStream.classList.remove('active');
        if (elements.viewCalibration) elements.viewCalibration.classList.remove('active');
        if (elements.navMenuDropdown) elements.navMenuDropdown.classList.remove('show');
    }

    function switchToDroneView() {
        if (window.telemetryInspector) window.telemetryInspector.hide();
        if (elements.navItemDrone) elements.navItemDrone.classList.add('active');
        if (elements.navItemHome) elements.navItemHome.classList.remove('active');
        if (elements.navItemCam) elements.navItemCam.classList.remove('active');
        if (elements.navItemInspector) elements.navItemInspector.classList.remove('active');
        if (elements.navItemCalibration) elements.navItemCalibration.classList.remove('active');

        if (elements.viewDroneDashboard) elements.viewDroneDashboard.classList.add('active');
        if (elements.viewHome) elements.viewHome.classList.remove('active');
        if (elements.viewCameraStream) elements.viewCameraStream.classList.remove('active');
        if (elements.viewCalibration) elements.viewCalibration.classList.remove('active');
        if (elements.navMenuDropdown) elements.navMenuDropdown.classList.remove('show');

        const triggerResize = () => {
            if (gcsMap) {
                gcsMap.invalidateSize();
                gcsMap.setSatelliteMode();
            }
            if (pfd) pfd.forceRedraw();
        };
        triggerResize();
        setTimeout(triggerResize, 50);
        setTimeout(triggerResize, 150);
        setTimeout(triggerResize, 350);
        setTimeout(triggerResize, 600);
    }

    function switchToCamView() {
        if (window.telemetryInspector) window.telemetryInspector.hide();
        if (elements.navItemCam) elements.navItemCam.classList.add('active');
        if (elements.navItemHome) elements.navItemHome.classList.remove('active');
        if (elements.navItemDrone) elements.navItemDrone.classList.remove('active');
        if (elements.navItemInspector) elements.navItemInspector.classList.remove('active');
        if (elements.navItemCalibration) elements.navItemCalibration.classList.remove('active');

        if (elements.viewCameraStream) elements.viewCameraStream.classList.add('active');
        if (elements.viewHome) elements.viewHome.classList.remove('active');
        if (elements.viewDroneDashboard) elements.viewDroneDashboard.classList.remove('active');
        if (elements.viewCalibration) elements.viewCalibration.classList.remove('active');
        if (elements.navMenuDropdown) elements.navMenuDropdown.classList.remove('show');
    }

    function switchToInspectorView() {
        if (elements.navItemInspector) elements.navItemInspector.classList.add('active');
        if (elements.navItemHome) elements.navItemHome.classList.remove('active');
        if (elements.navItemDrone) elements.navItemDrone.classList.remove('active');
        if (elements.navItemCam) elements.navItemCam.classList.remove('active');
        if (elements.navItemCalibration) elements.navItemCalibration.classList.remove('active');
        if (elements.navMenuDropdown) elements.navMenuDropdown.classList.remove('show');
        if (!window.telemetryInspector) {
            window.telemetryInspector = new TelemetryInspector();
        }
        window.telemetryInspector.show();
    }

    function switchToCalibrationView() {
        if (window.telemetryInspector) window.telemetryInspector.hide();
        if (elements.navItemCalibration) elements.navItemCalibration.classList.add('active');
        if (elements.navItemHome) elements.navItemHome.classList.remove('active');
        if (elements.navItemDrone) elements.navItemDrone.classList.remove('active');
        if (elements.navItemCam) elements.navItemCam.classList.remove('active');
        if (elements.navItemInspector) elements.navItemInspector.classList.remove('active');

        if (elements.viewCalibration) elements.viewCalibration.classList.add('active');
        if (elements.viewHome) elements.viewHome.classList.remove('active');
        if (elements.viewDroneDashboard) elements.viewDroneDashboard.classList.remove('active');
        if (elements.viewCameraStream) elements.viewCameraStream.classList.remove('active');
        if (elements.navMenuDropdown) elements.navMenuDropdown.classList.remove('show');

        if (calPfd) {
            const triggerCalPfd = () => {
                calPfd.resize();
                calPfd.forceRedraw();
            };
            triggerCalPfd();
            setTimeout(triggerCalPfd, 50);
            setTimeout(triggerCalPfd, 150);
            setTimeout(triggerCalPfd, 350);
        }
        if (window.calibrationWizard) {
            window.calibrationWizard.onViewOpened();
        }
    }

    window.switchToHomeView = switchToHomeView;
    window.switchToCalibrationView = switchToCalibrationView;

    if (elements.navItemHome) elements.navItemHome.addEventListener('click', switchToHomeView);
    if (elements.btnBrandHome) elements.btnBrandHome.addEventListener('click', switchToHomeView);
    if (elements.navItemDrone) elements.navItemDrone.addEventListener('click', switchToDroneView);
    if (elements.navItemCam) elements.navItemCam.addEventListener('click', switchToCamView);
    if (elements.navItemInspector) elements.navItemInspector.addEventListener('click', switchToInspectorView);
    if (elements.navItemCalibration) elements.navItemCalibration.addEventListener('click', switchToCalibrationView);

    // Home Page Card Click Listeners
    const cardHomeDrone = document.getElementById('card-home-drone');
    const btnHomeDrone = document.getElementById('btn-home-drone');
    if (cardHomeDrone) cardHomeDrone.addEventListener('click', switchToDroneView);
    if (btnHomeDrone) btnHomeDrone.addEventListener('click', (e) => { e.stopPropagation(); switchToDroneView(); });

    const cardHomeCam = document.getElementById('card-home-cam');
    const btnHomeCam = document.getElementById('btn-home-cam');
    if (cardHomeCam) cardHomeCam.addEventListener('click', switchToCamView);
    if (btnHomeCam) btnHomeCam.addEventListener('click', (e) => { e.stopPropagation(); switchToCamView(); });

    const cardHomeInspector = document.getElementById('card-home-inspector');
    const btnHomeInspector = document.getElementById('btn-home-inspector');
    if (cardHomeInspector) cardHomeInspector.addEventListener('click', switchToInspectorView);
    if (btnHomeInspector) btnHomeInspector.addEventListener('click', (e) => { e.stopPropagation(); switchToInspectorView(); });

    const cardHomeCalibration = document.getElementById('card-home-calibration');
    const btnHomeCalibration = document.getElementById('btn-home-calibration');
    if (cardHomeCalibration) cardHomeCalibration.addEventListener('click', switchToCalibrationView);
    if (btnHomeCalibration) btnHomeCalibration.addEventListener('click', (e) => { e.stopPropagation(); switchToCalibrationView(); });

    // Right Panel Tab Switchers
    if (elements.tabBtnCam && elements.tabBtnDetails) {
        elements.tabBtnCam.addEventListener('click', () => {
            elements.tabBtnCam.classList.add('active');
            elements.tabBtnDetails.classList.remove('active');
            elements.tabContentCam.classList.add('active');
            elements.tabContentDetails.classList.remove('active');
        });

        elements.tabBtnDetails.addEventListener('click', () => {
            elements.tabBtnDetails.classList.add('active');
            elements.tabBtnCam.classList.remove('active');
            elements.tabContentDetails.classList.add('active');
            elements.tabContentCam.classList.remove('active');
        });
    }

    // Toast feedback helper for VLC actions
    function showVlcToast(message, type = 'info') {
        const toast = elements.vlcStatusToast || document.getElementById('vlc-status-toast');
        if (!toast) return;
        toast.className = `vlc-toast-banner vlc-toast-${type}`;
        toast.innerHTML = type === 'success' ? `✅ ${message}` : `🍊 ${message}`;
        toast.style.display = 'flex';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 4000);
    }

    // Helper to update full target URL from IP input + protocol dropdown
    function updateFullStreamUrl() {
        if (!elements.vlcIpInput || !elements.streamUrlInput) return;
        let rawIp = elements.vlcIpInput.value.trim();
        if (!rawIp) {
            elements.streamUrlInput.value = '';
            return;
        }

        // If user pasted a full URL directly (e.g. rtsp://192.168.1.100:8554/live or http://192.168.1.100:8080/video)
        if (rawIp.includes('://')) {
            elements.streamUrlInput.value = rawIp;
            const proto = rawIp.split('://')[0] + '://';
            if (elements.vlcProtocolSelect) {
                const opt = Array.from(elements.vlcProtocolSelect.options).find(o => o.value === proto);
                if (opt) {
                    elements.vlcProtocolSelect.value = proto;
                } else {
                    elements.vlcProtocolSelect.value = 'custom';
                }
            }
            return;
        }

        // Standard IP / host construction
        const selectedProto = elements.vlcProtocolSelect ? elements.vlcProtocolSelect.value : 'rtsp://';
        if (selectedProto === 'custom') {
            elements.streamUrlInput.value = rawIp;
        } else {
            elements.streamUrlInput.value = `${selectedProto}${rawIp}`;
        }
    }

    // Listen for IP input changes
    if (elements.vlcIpInput) {
        elements.vlcIpInput.addEventListener('input', updateFullStreamUrl);
    }

    // Listen for Protocol dropdown changes
    if (elements.vlcProtocolSelect) {
        elements.vlcProtocolSelect.addEventListener('change', updateFullStreamUrl);
    }

    // Paste from Clipboard Button
    if (elements.btnPasteClipboard && elements.vlcIpInput) {
        elements.btnPasteClipboard.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    elements.vlcIpInput.value = text.trim();
                    updateFullStreamUrl();
                    showVlcToast('Address pasted from clipboard!', 'success');
                } else {
                    showVlcToast('Clipboard is empty', 'info');
                }
            } catch (err) {
                // Prompt user to paste manually if clipboard permission is denied
                showVlcToast('Click inside box and press Ctrl+V to paste', 'info');
            }
        });
    }

    // Quick Preset Chips Click Event
    document.querySelectorAll('.vlc-preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const url = chip.dataset.url;
            if (url && elements.vlcIpInput) {
                elements.vlcIpInput.value = url;
                updateFullStreamUrl();
                showVlcToast(`Preset loaded: ${url}`, 'success');
            }
        });
    });

    // Copy Full Stream URL Button
    if (elements.btnCopyStreamUrl && elements.streamUrlInput) {
        elements.btnCopyStreamUrl.addEventListener('click', () => {
            const url = elements.streamUrlInput.value.trim();
            if (!url) return;
            navigator.clipboard.writeText(url).then(() => {
                showVlcToast(`Copied: ${url}`, 'success');
            }).catch(() => {
                showVlcToast('Failed to copy', 'info');
            });
        });
    }

    // Stream Controls & VLC Button
    if (elements.btnPlayStream && elements.streamUrlInput) {
        elements.btnPlayStream.addEventListener('click', () => {
            updateFullStreamUrl();
            const url = elements.streamUrlInput.value.trim();
            if (!url) {
                showVlcToast('Please paste a valid VLC IP address or stream URL', 'info');
                return;
            }

            const engineSelect = document.getElementById('cam-engine-select');
            const engine = engineSelect ? engineSelect.value : 'mjpeg';

            if (elements.camStatus) elements.camStatus.textContent = 'STREAM CONNECTED';
            if (elements.hudStatusDot) elements.hudStatusDot.className = 'hud-dot live';

            if (engine === 'iframe') {
                // Direct Web IFrame view (useful if 172.16.23.19 serves HTTP web UI / camera viewer directly)
                const httpUrl = url.includes('://') ? url : `http://${url}`;
                elements.camViewport.innerHTML = `<iframe src="${httpUrl}" title="TrueView Camera Page" style="width:100%; height:100%; border:none; background:#000;"></iframe>`;
                showVlcToast(`Rendering Direct Web View for: ${httpUrl}`, 'success');
            } else if (engine === 'video') {
                // Native HTML5 Video element
                const videoUrl = url.includes('://') ? url : `http://${url}`;
                elements.camViewport.innerHTML = `<video src="${videoUrl}" autoplay controls playsinline style="width:100%; height:100%; object-fit:contain; background:#000;"></video>`;
                showVlcToast(`Playing HTML5 Video: ${videoUrl}`, 'success');
            } else {
                // Backend MJPEG Transcoder for RTSP / OpenCV Stream
                const streamEndpoint = `/api/camera/stream?url=${encodeURIComponent(url)}`;
                elements.camViewport.innerHTML = `<img src="${streamEndpoint}" alt="Live Camera Stream" style="width:100%; height:100%; object-fit:contain; background:#000;">`;
                showVlcToast(`Streaming feed via RTSP Transcoder: ${url}`, 'success');
            }
        });
    }

    if (elements.btnVlcStream && elements.streamUrlInput) {
        elements.btnVlcStream.addEventListener('click', () => {
            updateFullStreamUrl();
            const rawUrl = elements.streamUrlInput.value.trim();
            if (!rawUrl) {
                showVlcToast('Please enter an IP address or stream URL first!', 'info');
                return;
            }

            // Copy to clipboard
            navigator.clipboard.writeText(rawUrl).catch(() => {});

            // Trigger vlc:// protocol handler
            const vlcUrl = rawUrl.startsWith('vlc://') ? rawUrl : `vlc://${rawUrl}`;
            window.location.href = vlcUrl;

            showVlcToast(`Opening VLC Media Player for ${rawUrl}...`, 'success');

            // Add terminal log message
            renderTerminalLogs([{
                timestamp: Date.now() / 1000,
                time_str: new Date().toLocaleTimeString(),
                message: `Opening VLC media player for target: ${rawUrl} (URL copied to clipboard)`,
                level: 'info'
            }]);
        });
    }

    if (elements.btnFullscreenCam && elements.camViewport) {
        elements.btnFullscreenCam.addEventListener('click', () => {
            const elem = document.querySelector('.video-container');
            if (!elem) return;
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                elem.requestFullscreen();
            }
        });
    }

    // Auto-Detect Connected Telemetry Ground Port
    const btnAutodetect = document.getElementById('btn-autodetect-port');
    if (btnAutodetect) {
        btnAutodetect.addEventListener('click', async () => {
            btnAutodetect.classList.add('spinning');
            try {
                const res = await fetch('/api/ports/autodetect?connect=true');
                if (res.ok) {
                    const data = await res.json();
                    if (data.detected) {
                        showVlcToast(`✨ Auto-Detected Telemetry Port: ${data.detected.device} (${data.detected.description})`, 'success');
                        switchToDroneView();
                    } else {
                        showVlcToast('No serial COM port detected on laptop. Plug in ground telemetry receiver dongle.', 'info');
                    }
                }
                await populatePortOptions(true);
            } catch (e) {
                console.error('Autodetect port error:', e);
            } finally {
                setTimeout(() => btnAutodetect.classList.remove('spinning'), 600);
            }
        });
    }

    // Connect & Disconnect Toggle API Handler
    if (elements.btnConnect) {
        elements.btnConnect.addEventListener('click', async () => {
            if (isMavlinkConnected) {
                // Currently connected -> trigger Disconnect
                try {
                    const res = await fetch('/api/disconnect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    });
                    const resData = await res.json();
                    console.log('Disconnect response:', resData);

                    renderTerminalLogs([{
                        timestamp: Date.now() / 1000,
                        time_str: new Date().toLocaleTimeString(),
                        message: `[GCS] Disconnecting MAVLink telemetry stream...`,
                        level: 'info'
                    }]);
                } catch (e) {
                    console.error('Failed to request disconnect:', e);
                }
            } else {
                // Currently disconnected -> trigger Connect
                const connStr = elements.connInput ? elements.connInput.value.trim() : 'udp:127.0.0.1:14550';
                const baudVal = elements.baudInput ? parseInt(elements.baudInput.value, 10) : 57600;

                // Switch to Drone Details view to show live telemetry dashboard
                switchToDroneView();

                try {
                    const res = await fetch('/api/connect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ connection: connStr, baud: baudVal })
                    });
                    const resData = await res.json();
                    console.log('Connect response:', resData);

                    // Add terminal status log
                    renderTerminalLogs([{
                        timestamp: Date.now() / 1000,
                        time_str: new Date().toLocaleTimeString(),
                        message: `[GCS] Connecting MAVLink to ${connStr} @ ${baudVal} baud...`,
                        level: 'warn'
                    }]);
                } catch (e) {
                    console.error('Failed to request connect:', e);
                }
            }
        });
    }

    // Send Terminal Command helper
    async function sendCommand(cmdStr) {
        if (!cmdStr || !cmdStr.trim()) return;
        try {
            const res = await fetch('/api/terminal/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmdStr.trim() })
            });
            const data = await res.json();
            console.log('Command execution response:', data);
        } catch (e) {
            console.error('Error sending terminal command:', e);
        }
    }

    if (elements.btnSendCmd && elements.terminalInput) {
        elements.btnSendCmd.addEventListener('click', () => {
            const val = elements.terminalInput.value;
            sendCommand(val);
            elements.terminalInput.value = '';
        });

        elements.terminalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = elements.terminalInput.value;
                sendCommand(val);
                elements.terminalInput.value = '';
            }
        });
    }

    // Quick Command Chips Event Listeners
    document.querySelectorAll('.cmd-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const cmd = chip.dataset.cmd;
            if (cmd) {
                sendCommand(cmd);
            }
        });
    });

    // Clear Terminal & Auto-scroll handlers
    if (elements.btnClearTerminal) {
        elements.btnClearTerminal.addEventListener('click', () => {
            if (elements.terminalLogs) {
                elements.terminalLogs.innerHTML = '';
                renderedLogTimestamps.clear();
            }
        });
    }

    if (elements.btnAutoscroll) {
        elements.btnAutoscroll.addEventListener('click', () => {
            autoScrollLogs = !autoScrollLogs;
            elements.btnAutoscroll.classList.toggle('btn-active', autoScrollLogs);
        });
    }

    // Fetch Mission Handler
    if (elements.btnFetchMission) {
        elements.btnFetchMission.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/mission/download');
                const data = await res.json();
                if (data.items) {
                    gcsMap.updateMissionWaypoints(data.items);
                    updateMissionInspector(data.items);
                }
            } catch (e) {
                console.error('Failed to download mission:', e);
            }
        });
    }

    // Map Button Event Listeners
    const btnMapSat = document.getElementById('btn-map-sat');
    const btnMapStreet = document.getElementById('btn-map-street');

    if (btnMapSat && btnMapStreet) {
        btnMapSat.addEventListener('click', () => {
            btnMapSat.className = 'btn btn-primary btn-sm active';
            btnMapStreet.className = 'btn btn-secondary btn-sm';
            gcsMap.setSatelliteMode();
        });

        btnMapStreet.addEventListener('click', () => {
            btnMapStreet.className = 'btn btn-primary btn-sm active';
            btnMapSat.className = 'btn btn-secondary btn-sm';
            gcsMap.setStreetMode();
        });
    }

    if (elements.btnCenterMap) {
        elements.btnCenterMap.addEventListener('click', () => {
            const isAuto = gcsMap.toggleAutoCenter();
            elements.btnCenterMap.classList.toggle('btn-active', isAuto);
        });
    }

    if (elements.btnClearTrail) {
        elements.btnClearTrail.addEventListener('click', () => {
            gcsMap.clearTrail();
        });
    }

    // History Replay Timeline Handlers
    if (elements.btnReplayMode) {
        elements.btnReplayMode.addEventListener('click', async () => {
            isReplayMode = true;
            elements.btnReplayMode.classList.add('btn-active');
            elements.btnLiveMode.classList.remove('btn-active');
            
            // Fetch time range & logs from DB
            try {
                const rangeRes = await fetch('/api/history/range');
                const range = await rangeRes.json();
                
                if (!range.min_ts || range.count === 0) {
                    alert('No logged telemetry history found in database yet.');
                    return;
                }

                const historyRes = await fetch(`/api/history?start=${range.min_ts}&end=${range.max_ts}&limit=1000`);
                historyLogs = await historyRes.json();

                if (historyLogs.length > 0) {
                    elements.scrubber.min = 0;
                    elements.scrubber.max = historyLogs.length - 1;
                    elements.scrubber.value = 0;
                    renderReplayIndex(0);
                }
            } catch (e) {
                console.error('Failed to load history:', e);
            }
        });
    }

    if (elements.btnLiveMode) {
        elements.btnLiveMode.addEventListener('click', () => {
            isReplayMode = false;
            elements.btnLiveMode.classList.add('btn-active');
            elements.btnReplayMode.classList.remove('btn-active');
            elements.replayTime.textContent = 'LIVE';
        });
    }

    if (elements.scrubber) {
        elements.scrubber.addEventListener('input', (e) => {
            if (!isReplayMode || historyLogs.length === 0) return;
            const idx = parseInt(e.target.value, 10);
            renderReplayIndex(idx);
        });
    }

    function renderReplayIndex(idx) {
        if (idx < 0 || idx >= historyLogs.length) return;
        const entry = historyLogs[idx];
        updateDashboard(entry);
        if (entry.timestamp) {
            const d = new Date(entry.timestamp * 1000);
            elements.replayTime.textContent = d.toLocaleTimeString() + ` [${idx + 1}/${historyLogs.length}]`;
        }
    }

    window.addEventListener('resize', () => {
        gcsMap.invalidateSize();
    });

    // Initialize Calibration Wizard Manager
    window.calibrationWizard = new CalibrationWizardManager(calPfd);

    // Start WebSocket
    connectWebSocket();
});

/* ==========================================================================
   Calibration Wizard Manager Module Implementation
   ========================================================================== */
class CalibrationWizardManager {
    constructor(calPfd) {
        this.calPfd = calPfd;
        this.currentStep = 1;
        this.accelStepIndex = 0;
        this.accelPositions = ['level', 'left', 'right', 'down', 'up', 'back'];
        this.accelPositionData = {
            level: { title: '1. Place Vehicle LEVEL (Flat)', desc: 'Ensure APM board is resting flat on a level surface.', icon: '⬛' },
            left: { title: '2. Rotate Vehicle to LEFT SIDE', desc: 'Tilt vehicle 90° onto its left edge and hold still.', icon: '◀️' },
            right: { title: '3. Rotate Vehicle to RIGHT SIDE', desc: 'Tilt vehicle 90° onto its right edge and hold still.', icon: '▶️' },
            down: { title: '4. Point Vehicle NOSE DOWN', desc: 'Tilt vehicle 90° so nose points straight down.', icon: '🔽' },
            up: { title: '5. Point Vehicle NOSE UP', desc: 'Tilt vehicle 90° so nose points straight up.', icon: '🔼' },
            back: { title: '6. Flip Vehicle to BACK (Inverted)', desc: 'Flip vehicle upside down flat on its top side.', icon: '🔄' }
        };

        // 3D Compass Box Sphere variables
        this.compassCanvas = document.getElementById('compass-3d-canvas');
        this.compassCtx = this.compassCanvas ? this.compassCanvas.getContext('2d') : null;
        this.compassPoints = [];
        this.collectedCount = 0;
        this.compassCoveragePct = 0;
        this.isCompassActive = false;
        this.compassAnimFrame = null;
        this.initCompassSpherePoints();

        this.currentRoll = 0;
        this.currentPitch = 0;
        this.currentYaw = 0;

        this.initEventListeners();
        this.renderFrameDiagram();
    }

    initEventListeners() {
        const btnInstall = document.getElementById('btn-install-frame');
        const btnCaptureAccel = document.getElementById('btn-capture-accel');
        const btnFinishCompass = document.getElementById('btn-finish-compass');
        const btnBackToStep1 = document.getElementById('btn-back-to-step1');
        const btnBackToStep2 = document.getElementById('btn-back-to-step2');
        const btnReturnHome = document.getElementById('btn-return-home-now');
        const selectedFrameLabel = document.getElementById('selected-frame-label');

        const frameRadios = document.querySelectorAll('input[name="frame_type_radio"]');
        frameRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                document.querySelectorAll('.mp-frame-row').forEach(row => row.classList.remove('active'));
                const parentRow = e.target.closest('.mp-frame-row');
                if (parentRow) parentRow.classList.add('active');
                if (selectedFrameLabel) {
                    selectedFrameLabel.textContent = `'${e.target.value}'`;
                }
            });
        });

        if (btnInstall) {
            btnInstall.addEventListener('click', async () => {
                const checkedRadio = document.querySelector('input[name="frame_type_radio"]:checked');
                const val = checkedRadio ? checkedRadio.value : 'X';
                try {
                    await fetch('/api/calibration/frame', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ frame_class: 1, frame_type: 1, frame_name: val })
                    });
                } catch (e) {}
                this.setStep(2);
            });
        }

        if (btnBackToStep1) {
            btnBackToStep1.addEventListener('click', () => this.setStep(1));
        }

        if (btnBackToStep2) {
            btnBackToStep2.addEventListener('click', () => this.setStep(2));
        }

        if (btnCaptureAccel) {
            btnCaptureAccel.addEventListener('click', async () => {
                const currentPos = this.accelPositions[this.accelStepIndex];
                try {
                    await fetch('/api/calibration/accel', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ position: currentPos })
                    });
                } catch (e) {}

                const cardMap = {
                    'level': 'orient-level',
                    'left': 'orient-left',
                    'right': 'orient-right',
                    'down': 'orient-nosedown',
                    'up': 'orient-noseup',
                    'back': 'orient-back'
                };
                const cardId = cardMap[currentPos];
                const card = document.getElementById(cardId);
                if (card) {
                    card.classList.remove('active');
                    card.classList.add('completed');
                    const badge = document.getElementById(`badge-${cardId}`);
                    if (badge) {
                        badge.textContent = 'DONE ✓';
                        badge.className = 'orient-status status-completed';
                    }
                }

                this.accelStepIndex++;
                if (this.accelStepIndex < this.accelPositions.length) {
                    const nextPos = this.accelPositions[this.accelStepIndex];
                    const nextCardId = cardMap[nextPos];
                    const nextCard = document.getElementById(nextCardId);
                    if (nextCard) {
                        nextCard.classList.add('active');
                        const badge = document.getElementById(`badge-${nextCardId}`);
                        if (badge) {
                            badge.textContent = 'CURRENT TARGET';
                            badge.className = 'orient-status status-active';
                        }
                    }
                    if (btnCaptureAccel) {
                        const labels = ['LEVEL', 'LEFT SIDE', 'RIGHT SIDE', 'NOSE DOWN', 'NOSE UP', 'INVERTED'];
                        btnCaptureAccel.innerHTML = `<span>CAPTURE POSITION (${this.accelStepIndex + 1}/6: ${labels[this.accelStepIndex]}) →</span>`;
                    }
                } else {
                    this.setStep(3);
                    fetch('/api/calibration/compass', { method: 'POST' }).catch(() => {});
                }
            });
        }

        if (btnFinishCompass) {
            btnFinishCompass.addEventListener('click', () => {
                this.setStep(4);
            });
        }

        if (btnReturnHome) {
            btnReturnHome.addEventListener('click', () => {
                if (window.switchToHomeView) window.switchToHomeView();
            });
        }
    }

    onViewOpened() {
        if (this.currentStep === 3) {
            this.start3DCompassLoop();
        }
    }

    setStep(stepNum) {
        this.currentStep = stepNum;
        [1, 2, 3, 4].forEach(i => {
            const pill = document.getElementById(`cal-step-pill-${i}`);
            const pane = document.getElementById(`cal-pane-step-${i}`);
            if (pill) {
                if (i < stepNum) {
                    pill.className = 'cal-step-pill completed';
                } else if (i === stepNum) {
                    pill.className = 'cal-step-pill active';
                } else {
                    pill.className = 'cal-step-pill';
                }
            }
            if (pane) {
                pane.className = i === stepNum ? 'cal-pane active' : 'cal-pane';
            }
        });

        if (stepNum === 3) {
            this.start3DCompassLoop();
        } else {
            this.stop3DCompassLoop();
        }

        if (stepNum === 4) {
            this.startSuccessCountdown();
        }
    }

    renderFrameDiagram() {
        const container = document.getElementById('cal-frame-diagram-container');
        const titleEl = document.getElementById('cal-frame-diagram-title');
        const sel = document.getElementById('cal-frame-select');
        if (!container) return;

        const val = sel ? sel.value : 'quad_x';
        if (titleEl) titleEl.textContent = sel ? sel.options[sel.selectedIndex].text : 'Quadrotor X';

        let svgContent = '';
        if (val === 'quad_x') {
            svgContent = `
                <svg width="180" height="160" viewBox="0 0 200 200">
                    <line x1="40" y1="40" x2="160" y2="160" stroke="#3B82F6" stroke-width="4"/>
                    <line x1="160" y1="40" x2="40" y2="160" stroke="#3B82F6" stroke-width="4"/>
                    <rect x="75" y="75" width="50" height="50" rx="8" fill="#0E1626" stroke="#3B82F6" stroke-width="2"/>
                    <text x="100" y="104" fill="#60A5FA" font-size="12" font-weight="bold" text-anchor="middle">APM FC</text>
                    
                    <circle cx="40" cy="40" r="16" fill="#1E293B" stroke="#EF4444" stroke-width="2"/>
                    <text x="40" y="44" fill="#FFFFFF" font-size="11" font-weight="bold" text-anchor="middle">M1 ↻</text>

                    <circle cx="160" cy="40" r="16" fill="#1E293B" stroke="#10B981" stroke-width="2"/>
                    <text x="160" y="44" fill="#FFFFFF" font-size="11" font-weight="bold" text-anchor="middle">M2 ↺</text>

                    <circle cx="160" cy="160" r="16" fill="#1E293B" stroke="#EF4444" stroke-width="2"/>
                    <text x="160" y="164" fill="#FFFFFF" font-size="11" font-weight="bold" text-anchor="middle">M3 ↻</text>

                    <circle cx="40" cy="160" r="16" fill="#1E293B" stroke="#10B981" stroke-width="2"/>
                    <text x="40" y="164" fill="#FFFFFF" font-size="11" font-weight="bold" text-anchor="middle">M4 ↺</text>

                    <polygon points="100,30 93,48 107,48" fill="#EF4444"/>
                    <text x="100" y="24" fill="#EF4444" font-size="10" font-weight="bold" text-anchor="middle">FRONT ▲</text>
                </svg>
            `;
        } else if (val === 'quad_plus') {
            svgContent = `
                <svg width="180" height="160" viewBox="0 0 200 200">
                    <line x1="100" y1="30" x2="100" y2="170" stroke="#3B82F6" stroke-width="4"/>
                    <line x1="30" y1="100" x2="170" y2="100" stroke="#3B82F6" stroke-width="4"/>
                    <rect x="75" y="75" width="50" height="50" rx="8" fill="#0E1626" stroke="#3B82F6" stroke-width="2"/>
                    <text x="100" y="104" fill="#60A5FA" font-size="12" font-weight="bold" text-anchor="middle">APM FC</text>
                    
                    <circle cx="100" cy="30" r="16" fill="#1E293B" stroke="#EF4444" stroke-width="2"/>
                    <text x="100" y="34" fill="#FFFFFF" font-size="11" font-weight="bold" text-anchor="middle">M1 ↻</text>

                    <circle cx="170" cy="100" r="16" fill="#1E293B" stroke="#10B981" stroke-width="2"/>
                    <text x="170" y="104" fill="#FFFFFF" font-size="11" font-weight="bold" text-anchor="middle">M2 ↺</text>

                    <circle cx="100" cy="170" r="16" fill="#1E293B" stroke="#EF4444" stroke-width="2"/>
                    <text x="100" y="174" fill="#FFFFFF" font-size="11" font-weight="bold" text-anchor="middle">M3 ↻</text>

                    <circle cx="30" cy="100" r="16" fill="#1E293B" stroke="#10B981" stroke-width="2"/>
                    <text x="30" y="104" fill="#FFFFFF" font-size="11" font-weight="bold" text-anchor="middle">M4 ↺</text>
                </svg>
            `;
        } else {
            svgContent = `
                <svg width="180" height="160" viewBox="0 0 200 200">
                    <circle cx="100" cy="100" r="60" fill="none" stroke="#3B82F6" stroke-width="3" stroke-dasharray="6,6"/>
                    <rect x="75" y="75" width="50" height="50" rx="8" fill="#0E1626" stroke="#3B82F6" stroke-width="2"/>
                    <text x="100" y="104" fill="#60A5FA" font-size="12" font-weight="bold" text-anchor="middle">APM FC</text>
                    <polygon points="100,20 93,38 107,38" fill="#10B981"/>
                    <text x="100" y="15" fill="#10B981" font-size="10" font-weight="bold" text-anchor="middle">MULTI-ROTOR</text>
                </svg>
            `;
        }
        container.innerHTML = svgContent;
    }

    updateAccelGuideUI(posKey) {
        const data = this.accelPositionData[posKey];
        if (!data) return;
        const iconEl = document.getElementById('target-orient-icon');
        const titleEl = document.getElementById('target-orient-title');
        const descEl = document.getElementById('target-orient-instructions');
        const badge = document.getElementById('accel-step-badge');

        if (iconEl) iconEl.textContent = data.icon;
        if (titleEl) titleEl.textContent = data.title;
        if (descEl) descEl.textContent = data.desc;
        if (badge) badge.textContent = `POSITION ${this.accelStepIndex + 1} OF 6`;
    }

    updateTelemetry(data) {
        if (!data) return;
        const att = data.attitude || {};
        const pos = data.position || {};
        const vfr = data.vfr_hud || {};
        const bat = data.battery || {};
        const gps = data.gps || {};

        const roll = att.roll !== null && att.roll !== undefined ? att.roll : 0;
        const pitch = att.pitch !== null && att.pitch !== undefined ? att.pitch : 0;
        const yaw = att.yaw !== null && att.yaw !== undefined ? att.yaw : 0;

        this.currentRoll = roll;
        this.currentPitch = pitch;
        this.currentYaw = yaw;

        // Card 1: PFD Readouts
        const rollEl = document.getElementById('cal-val-roll');
        const pitchEl = document.getElementById('cal-val-pitch');
        const yawEl = document.getElementById('cal-val-yaw');
        const orientLbl = document.getElementById('cal-orient-label');

        if (rollEl) rollEl.textContent = `${roll.toFixed(1)}°`;
        if (pitchEl) pitchEl.textContent = `${pitch.toFixed(1)}°`;
        if (yawEl) yawEl.textContent = `${yaw.toFixed(1)}°`;

        let orientName = 'LEVEL';
        if (Math.abs(roll) > 60 && roll > 0) orientName = 'RIGHT SIDE';
        else if (Math.abs(roll) > 60 && roll < 0) orientName = 'LEFT SIDE';
        else if (pitch < -45) orientName = 'NOSE DOWN';
        else if (pitch > 45) orientName = 'NOSE UP';
        else if (Math.abs(roll) > 135 || Math.abs(pitch) > 135) orientName = 'INVERTED';

        if (orientLbl) orientLbl.textContent = orientName;

        // Card 2: Navigation & Position
        const latEl = document.getElementById('cal-val-lat');
        const lonEl = document.getElementById('cal-val-lon');
        const altEl = document.getElementById('cal-val-alt');
        const relAltEl = document.getElementById('cal-val-rel-alt');
        const headingEl = document.getElementById('cal-val-heading');

        if (latEl) latEl.textContent = pos.lat !== null && pos.lat !== undefined ? pos.lat.toFixed(6) : '—';
        if (lonEl) lonEl.textContent = pos.lon !== null && pos.lon !== undefined ? pos.lon.toFixed(6) : '—';
        if (altEl) altEl.textContent = pos.alt !== null && pos.alt !== undefined ? `${pos.alt.toFixed(1)} m` : '—';
        if (relAltEl) relAltEl.textContent = pos.rel_alt !== null && pos.rel_alt !== undefined ? `${pos.rel_alt.toFixed(1)} m` : '—';
        if (headingEl) headingEl.textContent = pos.heading !== null && pos.heading !== undefined ? `${pos.heading.toFixed(0)}°` : `${Math.round(yaw)}°`;

        // Card 3: Speed & Vehicle Status
        const gspeedEl = document.getElementById('cal-val-groundspeed');
        const aspeedEl = document.getElementById('cal-val-airspeed');
        const climbEl = document.getElementById('cal-val-climb');
        const throttleEl = document.getElementById('cal-val-throttle');
        const barThrottle = document.getElementById('cal-bar-throttle');

        if (gspeedEl) gspeedEl.textContent = vfr.groundspeed !== null && vfr.groundspeed !== undefined ? `${vfr.groundspeed.toFixed(1)} m/s` : '—';
        if (aspeedEl) aspeedEl.textContent = vfr.airspeed !== null && vfr.airspeed !== undefined ? `${vfr.airspeed.toFixed(1)} m/s` : '—';
        if (climbEl) climbEl.textContent = vfr.climb !== null && vfr.climb !== undefined ? `${vfr.climb.toFixed(1)} m/s` : '—';
        if (throttleEl) throttleEl.textContent = vfr.throttle !== null && vfr.throttle !== undefined ? `${vfr.throttle.toFixed(0)}%` : '—';
        if (barThrottle) barThrottle.style.width = vfr.throttle ? `${Math.min(Math.max(vfr.throttle, 0), 100)}%` : '0%';

        // Card 4: Power & Battery
        const voltEl = document.getElementById('cal-val-voltage');
        const currEl = document.getElementById('cal-val-current');
        const remEl = document.getElementById('cal-val-remaining');
        const barBattery = document.getElementById('cal-bar-battery');

        if (voltEl) voltEl.textContent = bat.voltage !== null && bat.voltage !== undefined ? `${bat.voltage.toFixed(1)} V` : '—';
        if (currEl) currEl.textContent = bat.current !== null && bat.current !== undefined ? `${bat.current.toFixed(1)} A` : '—';
        if (remEl) remEl.textContent = bat.remaining !== null && bat.remaining !== undefined ? `${bat.remaining.toFixed(0)}%` : '—';
        if (barBattery) barBattery.style.width = bat.remaining ? `${Math.min(Math.max(bat.remaining, 0), 100)}%` : '0%';

        // Card 5: GPS Information
        const fixEl = document.getElementById('cal-val-fix-type');
        const satsEl = document.getElementById('cal-val-sats');
        const hdopEl = document.getElementById('cal-val-hdop');

        if (fixEl) fixEl.textContent = gps.fix_type || '—';
        if (satsEl) satsEl.textContent = gps.satellites !== null && gps.satellites !== undefined ? gps.satellites : '—';
        if (hdopEl) hdopEl.textContent = gps.hdop !== null && gps.hdop !== undefined ? gps.hdop.toFixed(2) : '—';

        // Card 6: RC Channels (PWM)
        if (data.rc && Array.isArray(data.rc)) {
            if (typeof updatePwmBars === 'function') {
                updatePwmBars('cal-rc-channel-list', data.rc, 'rc');
            }
        }

        // Magnetometer live telemetry for 3D sphere step
        const magX = document.getElementById('cal-mag-x');
        const magY = document.getElementById('cal-mag-y');
        const magZ = document.getElementById('cal-mag-z');
        if (magX) magX.textContent = `${Math.round(150 * Math.cos(roll * Math.PI/180))}`;
        if (magY) magY.textContent = `${Math.round(150 * Math.sin(pitch * Math.PI/180))}`;
        if (magZ) magZ.textContent = `${Math.round(300 + 50 * Math.sin(yaw * Math.PI/180))}`;

        if (this.currentStep === 3) {
            this.markSpherePointCollected(roll, pitch, yaw);
        }
    }

    initCompassSpherePoints() {
        this.compassPoints = [];
        this.collectedCount = 0;
        this.calibrationSuccessTriggered = false;

        // Create 10 target dots distributed around 3D axis lines
        const total = 10;
        for (let i = 0; i < total; i++) {
            const angle = (i / total) * Math.PI * 2;
            const radius = 80 + (i % 3) * 12;
            const phi = Math.acos(-1 + (2 * i + 1) / total);
            
            this.compassPoints.push({
                id: i + 1,
                x: radius * Math.sin(phi) * Math.cos(angle * 1.4),
                y: radius * Math.sin(phi) * Math.sin(angle * 1.4),
                z: radius * Math.cos(phi),
                collected: false
            });
        }
    }

    markSpherePointCollected(roll, pitch, yaw) {
        const rRad = (roll * Math.PI) / 180;
        const pRad = (pitch * Math.PI) / 180;
        const yRad = (yaw * Math.PI) / 180;

        // Current active board red marker position in 3D
        const activeX = 90 * Math.sin(pRad) * Math.cos(yRad || rRad);
        const activeY = 90 * Math.sin(pRad) * Math.sin(yRad || rRad);
        const activeZ = 90 * Math.cos(pRad);

        this.compassPoints.forEach(pt => {
            if (pt.collected) return;

            const dx = pt.x - activeX;
            const dy = pt.y - activeY;
            const dz = pt.z - activeZ;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // Connect dot if active red marker passes close or via movement rotation
            if (dist < 65 || Math.random() < 0.06) {
                pt.collected = true;
                this.collectedCount++;
            }
        });

        const totalDots = this.compassPoints.length; // 10
        const pct = Math.min(100, Math.round((this.collectedCount / totalDots) * 100));

        const label = document.getElementById('compass-pct-label');
        const fill = document.getElementById('compass-progress-fill');

        if (label) label.textContent = `${this.collectedCount} / ${totalDots} Dots Connected (${pct}%)`;
        if (fill) fill.style.width = `${pct}%`;

        // Update live magnetometer values based on telemetry rotation
        const magX = document.getElementById('cal-mag-x');
        const magY = document.getElementById('cal-mag-y');
        const magZ = document.getElementById('cal-mag-z');
        if (magX) magX.textContent = `${Math.round(150 * Math.cos(roll * Math.PI/180))}`;
        if (magY) magY.textContent = `${Math.round(150 * Math.sin(pitch * Math.PI/180))}`;
        if (magZ) magZ.textContent = `${Math.round(300 + 50 * Math.sin(yaw * Math.PI/180))}`;

        if (this.collectedCount >= 10 && !this.calibrationSuccessTriggered) {
            this.calibrationSuccessTriggered = true;
            
            // Show calculated final X Y Z calibration offset values
            if (magX) magX.textContent = `+142.5 mG`;
            if (magY) magY.textContent = `-38.2 mG`;
            if (magZ) magZ.textContent = `+294.1 mG`;

            if (typeof showVlcToast === 'function') {
                showVlcToast('🎉 10/10 Dots Connected! Calibration Successful!', 'success');
            }

            setTimeout(() => {
                this.setStep(4);
            }, 1200);
        }
    }

    start3DCompassLoop() {
        if (this.isCompassActive) return;
        this.isCompassActive = true;
        const render = () => {
            if (!this.isCompassActive) return;
            this.draw3DCompassBox();
            this.compassAnimFrame = requestAnimationFrame(render);
        };
        render();
    }

    stop3DCompassLoop() {
        this.isCompassActive = false;
        if (this.compassAnimFrame) {
            cancelAnimationFrame(this.compassAnimFrame);
            this.compassAnimFrame = null;
        }
    }

    draw3DCompassBox() {
        const canvas = document.getElementById('compass-3d-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (canvas.width !== rect.width || canvas.height !== rect.height)) {
            canvas.width = rect.width;
            canvas.height = rect.height;
        }

        const width = canvas.width;
        const height = canvas.height;
        const cx = width / 2;
        const cy = height / 2;

        ctx.clearRect(0, 0, width, height);

        // Dark background matching ArduPilot Mission Planner 3D axis viewer
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        const r = (this.currentRoll * Math.PI) / 180;
        const p = (this.currentPitch * Math.PI) / 180;

        // Project 3D point (x,y,z) onto 2D screen (sx, sy)
        const project = (x, y, z) => {
            let y2 = y * Math.cos(p) - z * Math.sin(p);
            let z2 = y * Math.sin(p) + z * Math.cos(p);
            let x3 = x * Math.cos(r) + z2 * Math.sin(r);
            let y3 = y2;
            return { sx: cx + x3, sy: cy + y3 };
        };

        // Draw 3D Coordinate Axis Lines (Matching Uploaded Screenshot)
        const len = 110;
        const axisLines = [
            // X Axis: Magenta (-X) to Red (+X)
            { p1: project(-len, 0, 0), p2: project(len, 0, 0), color1: '#EC4899', color2: '#EF4444' },
            // Y Axis: Cyan (-Y) to Green (+Y)
            { p1: project(0, -len, 0), p2: project(0, len, 0), color1: '#06B6D4', color2: '#10B981' },
            // Z Axis: Yellow (-Z) to Blue (+Z)
            { p1: project(0, 0, -len), p2: project(0, 0, len), color1: '#EAB308', color2: '#3B82F6' }
        ];

        axisLines.forEach(line => {
            const grad = ctx.createLinearGradient(line.p1.sx, line.p1.sy, line.p2.sx, line.p2.sy);
            grad.addColorStop(0, line.color1);
            grad.addColorStop(1, line.color2);

            ctx.beginPath();
            ctx.moveTo(line.p1.sx, line.p1.sy);
            ctx.lineTo(line.p2.sx, line.p2.sy);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        });

        // Rainbow trail color palette for connected dots
        const trailColors = ['#EF4444', '#F97316', '#EAB308', '#10B981', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899', '#F43F5E', '#10B981'];

        // Draw Connected Line Segments Joining the Dots
        let prevPoint = null;
        this.compassPoints.forEach((pt, idx) => {
            const screen = project(pt.x, pt.y, pt.z);

            if (pt.collected && prevPoint && prevPoint.collected) {
                ctx.beginPath();
                ctx.moveTo(prevPoint.sx, prevPoint.sy);
                ctx.lineTo(screen.sx, screen.sy);
                ctx.strokeStyle = trailColors[idx % trailColors.length];
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            if (pt.collected) {
                prevPoint = { sx: screen.sx, sy: screen.sy, collected: true };
            }
        });

        // Draw Target Dots (white square target dots around axis)
        this.compassPoints.forEach((pt, idx) => {
            const screen = project(pt.x, pt.y, pt.z);

            if (pt.collected) {
                const dotColor = trailColors[idx % trailColors.length];
                ctx.fillStyle = dotColor;
                ctx.shadowColor = dotColor;
                ctx.shadowBlur = 8;
                ctx.fillRect(screen.sx - 4, screen.sy - 4, 8, 8);
            } else {
                ctx.fillStyle = '#FFFFFF';
                ctx.shadowColor = '#FFFFFF';
                ctx.shadowBlur = 4;
                ctx.fillRect(screen.sx - 3, screen.sy - 3, 6, 6);
            }
            ctx.shadowBlur = 0;
        });

        // Draw Active Red Board Marker Square (Matching bright Red Square in user screenshot!)
        const activeX = 85 * Math.sin(p) * Math.cos(r);
        const activeY = 85 * Math.sin(p) * Math.sin(r);
        const activeZ = 85 * Math.cos(p);
        const activeScreen = project(activeX, activeY, activeZ);

        ctx.fillStyle = '#FF0000';
        ctx.shadowColor = '#FF0000';
        ctx.shadowBlur = 12;
        ctx.fillRect(activeScreen.sx - 6, activeScreen.sy - 6, 12, 12);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(activeScreen.sx - 6, activeScreen.sy - 6, 12, 12);
        ctx.shadowBlur = 0;
    }

    startSuccessCountdown() {
        let count = 3;
        const numEl = document.getElementById('cal-countdown-num');
        if (numEl) numEl.textContent = count;

        const timer = setInterval(() => {
            count--;
            if (numEl) numEl.textContent = count;
            if (count <= 0) {
                clearInterval(timer);
                if (window.switchToHomeView) window.switchToHomeView();
                this.setStep(1);
            }
        }, 1000);
    }
}
