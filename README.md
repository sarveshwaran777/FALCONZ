# ArduPilot (APM) Live Web Dashboard & GCS

A custom, web-based ground control station (GCS) and live telemetry dashboard for ArduPilot (APM) flight controllers. Built with **Python (FastAPI + pymavlink)** on the backend and **WebSockets + HTML5 Canvas + Leaflet.js** on the frontend.

![APM Web Dashboard](static/index.html)

---

## Features

- 🛸 **Real-Time Telemetry Streaming**: Low-latency MAVLink decoding and WebSocket streaming (~5 Hz update rate).
- ✈️ **Primary Flight Display (PFD)**: Custom HTML5 Canvas Artificial Horizon with dynamic roll, pitch, pitch ladder, and degree indicators.
- 📡 **Connection Watchdog**: Automatic connection status detection (`LIVE` vs `DISCONNECTED`) with auto-reconnecting WebSockets.
- 🗺️ **Live Leaflet.js GPS Map**: Real-time position tracking with custom rotated vehicle marker, heading orientation, and trailing flight path.
- 🔋 **Comprehensive Telemetry Cards**:
  - **Flight Mode & Arming**: Live flight mode string (GUIDED, AUTO, STABILIZE, RTL, etc.) and bold arming status.
  - **Position & Navigation**: Latitude, Longitude, MSL Altitude, Relative Altitude (Above Home), and Heading.
  - **Speed & VFR HUD**: Groundspeed, Airspeed, Climb Rate, and Throttle percentage bar.
  - **Power & Battery**: Voltage, Current, Remaining battery %, and dynamic battery status fill.
  - **GPS Quality**: Fix type string (3D Fix, RTK Float, RTK Fixed), Satellite count, and HDOP.
  - **RC & Servo Channels**: Live 8-channel PWM pulse width gauges.
- 📜 **Telemetry Database Logging & Replay**: Automatically logs telemetry snapshots to an SQLite database (`telemetry.db`) with an interactive time scrubber to replay past flight logs.

---

## Tech Stack

- **Backend**: Python 3.9+, FastAPI, PyMAVLink, Uvicorn, SQLite3, PySerial
- **Frontend**: Vanilla HTML5, Vanilla CSS3 (Aerospace Dark Theme), JavaScript (ES6+), HTML5 Canvas, Leaflet.js

---

## Quickstart

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the Dashboard

To start the dashboard with default settings (UDP listening on port 14550):

```bash
python main.py --connection udp:127.0.0.1:14550
```

Open your browser to: **`http://localhost:8000`**

---

## Connection Modes

The backend supports multiple MAVLink source types via the `--connection` CLI argument:

### Mode 1: ArduPilot SITL Simulator

Run ArduPilot SITL (e.g. `sim_vehicle.py -v ArduCopter --console --map`). SITL automatically outputs MAVLink to `127.0.0.1:14550`. Run:

```bash
python main.py --connection udp:127.0.0.1:14550
```

---

### Mode 2: Direct Serial (USB Telemetry Radio / Direct FC USB)

Connect your 915MHz/433MHz telemetry radio transceiver or flight controller via USB.

**On Windows:**
```bash
python main.py --connection COM5 --baud 57600
```

**On Linux / macOS:**
```bash
python main.py --connection /dev/ttyUSB0 --baud 57600
```

---

### Mode 3: Mission Planner UDP Forwarding

You can run this dashboard **alongside Mission Planner** without disconnecting Mission Planner from your drone!

1. Open **Mission Planner** and connect to your drone via USB or Telemetry Radio.
2. In Mission Planner, press **`Ctrl` + `F`** to open the *Temp / Secret Tools* window.
3. Click the **Mavlink** button.
4. Select **UDP Client** (or **UDP Host**) from the dropdown menu and click **Connect**.
5. In the pop-up prompt:
   - Host IP: `127.0.0.1`
   - Remote Port: `14550`
6. Now start this web dashboard:
```bash
python main.py --connection udp:127.0.0.1:14550
```
Mission Planner will mirror its incoming MAVLink telemetry stream to `127.0.0.1:14550`, feeding both Mission Planner and your custom web dashboard simultaneously.

---

## Testing Without Hardware (Built-in Simulator)

If you don't have a drone or SITL running right now, you can use the included MAVLink telemetry simulator:

1. Terminal 1 (Run Dashboard Server):
```bash
python main.py --connection udp:127.0.0.1:14550
```

2. Terminal 2 (Run Telemetry Simulator):
```bash
python sim_mavlink.py --target 127.0.0.1:14550
```

3. Open **`http://localhost:8000`** to see live simulated flight telemetry!

---

## REST API Endpoints

- **`GET /api/telemetry`**: Returns a JSON snapshot of the latest decoded telemetry state.
- **`GET /api/history/range`**: Returns start/end timestamps and entry count for logged telemetry in SQLite.
- **`GET /api/history?start=...&end=...`**: Fetches historical telemetry entries for replay.
- **`GET /api/mission/download`**: Requests waypoints from the flight controller over MAVLink.
- **`WS /ws/telemetry`**: WebSocket endpoint streaming live JSON telemetry at ~5 Hz.

---

## Project Structure

```
DRONR/
├── main.py                 # FastAPI server & WebSocket broadcast endpoints
├── mavlink_manager.py      # PyMAVLink decoder thread & message handlers
├── database.py             # SQLite telemetry logger & history query manager
├── sim_mavlink.py          # Standalone MAVLink telemetry simulator script
├── requirements.txt        # Python dependency list
├── README.md               # Setup & usage documentation
└── static/
    ├── index.html          # Dashboard HTML UI
    ├── css/
    │   └── styles.css      # Aerospace GCS Dark Theme CSS
    └── js/
        ├── app.js          # Core WebSocket & DOM management script
        ├── attitude_indicator.js # Canvas Artificial Horizon (PFD)
        └── map.js          # Leaflet.js GPS vehicle map & trajectory trail
```
