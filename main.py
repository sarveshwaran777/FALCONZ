import argparse
import asyncio
import json
import os
import logging
from contextlib import asynccontextmanager
from typing import Set

import time
import math
import cv2
import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from database import TelemetryDB
from mavlink_manager import MAVLinkManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("APM-Dashboard")

# Parse command line arguments
parser = argparse.ArgumentParser(description="ArduPilot GCS Web Dashboard")
parser.add_argument("--connection", type=str, default="udp:127.0.0.1:14550",
                    help="MAVLink connection string (e.g. udp:127.0.0.1:14550, COM5, /dev/ttyUSB0)")
parser.add_argument("--baud", type=int, default=57600,
                    help="Serial baud rate for direct serial connections (default: 57600)")
parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address to bind server (default: 0.0.0.0)")
parser.add_argument("--port", type=int, default=8000, help="Port to bind server (default: 8000)")
parser.add_argument("--db", type=str, default="telemetry.db", help="Path to SQLite database file (default: telemetry.db)")

# Parse args (support being run via uvicorn directly or CLI)
try:
    args, _ = parser.parse_known_args()
except Exception:
    args = parser.parse_args([])

# Global instances
db = TelemetryDB(db_path=args.db)
mav_manager = MAVLinkManager(connection_string=args.connection, baud=args.baud, db_instance=db)

# Active WebSocket connections
active_connections: Set[WebSocket] = set()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start MAVLink thread & background WebSocket broadcast task
    logger.info(f"Starting MAVLink listener on {args.connection} (baud {args.baud})...")
    mav_manager.start()
    broadcast_task = asyncio.create_task(broadcast_telemetry_loop())
    yield
    # Shutdown
    logger.info("Stopping MAVLink listener...")
    broadcast_task.cancel()
    mav_manager.stop()

app = FastAPI(title="ArduPilot Live Dashboard", lifespan=lifespan)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Mount static directory
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

async def broadcast_telemetry_loop():
    """Broadcasts latest telemetry state to all WebSocket clients at ~5 Hz."""
    while True:
        try:
            if active_connections:
                state_data = mav_manager.get_state()
                json_payload = json.dumps(state_data)
                
                # Send to all connected sockets
                disconnected = set()
                for ws in list(active_connections):
                    try:
                        await ws.send_text(json_payload)
                    except Exception:
                        disconnected.add(ws)
                
                for ws in disconnected:
                    active_connections.remove(ws)
            
            await asyncio.sleep(0.2)  # 5 Hz update rate
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in broadcast loop: {e}")
            await asyncio.sleep(0.5)

@app.get("/", response_class=HTMLResponse)
async def get_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>APM Dashboard Frontend Not Found</h1>", status_code=44)

@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    logger.info(f"Client connected to WebSocket. Total clients: {len(active_connections)}")
    
    # Send immediate state on connect
    try:
        initial_state = mav_manager.get_state()
        await websocket.send_text(json.dumps(initial_state))
        
        while True:
            # Wait for client messages or ping disconnect
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            except asyncio.TimeoutError:
                # Heartbeat keep-alive: send ping state or continue loop
                continue
    except WebSocketDisconnect:
        logger.info("Client disconnected from WebSocket.")
    except Exception as e:
        logger.warning(f"WebSocket closed: {e}")
    finally:
        active_connections.discard(websocket)

from pydantic import BaseModel

class ConnectRequest(BaseModel):
    connection: str = "udp:127.0.0.1:14550"
    baud: int = 57600

class CommandRequest(BaseModel):
    command: str

@app.get("/api/ports")
@app.get("/api/connection/ports")
async def list_serial_ports():
    """Returns list of available physical serial COM ports and default UDP connection option."""
    ports = []
    try:
        import serial.tools.list_ports
        com_ports = serial.tools.list_ports.comports()
        for p in com_ports:
            desc = p.description or p.device
            manufacturer = getattr(p, 'manufacturer', '') or ''
            ports.append({
                "device": p.device,
                "description": desc,
                "hwid": p.hwid,
                "manufacturer": manufacturer,
                "is_serial": True
            })
    except Exception as e:
        logger.error(f"Error scanning serial ports: {e}")
    
    defaults = [
        {
            "device": "udp:127.0.0.1:14550",
            "description": "udp:127.0.0.1:14550 (UDP Sim/Network)",
            "is_serial": False
        }
    ]
    
    # Return simple device string array for legacy callers and full structured list
    simple_ports = [p["device"] for p in ports] + [d["device"] for d in defaults]
    
    return JSONResponse(content={
        "ports": simple_ports,
        "detailed_ports": ports,
        "defaults": defaults,
        "total_serial": len(ports)
    })

@app.get("/api/ports/autodetect")
async def autodetect_port(connect: bool = Query(False)):
    """Auto-detects first connected hardware serial telemetry port."""
    detected_port = None
    try:
        import serial.tools.list_ports
        com_ports = serial.tools.list_ports.comports()
        if com_ports:
            p = com_ports[0]
            desc = p.description or p.device
            detected_port = {
                "device": p.device,
                "description": desc,
                "is_serial": True
            }
    except Exception as e:
        logger.error(f"Autodetect error: {e}")

    if detected_port and connect:
        mav_manager.reconnect(connection_string=detected_port["device"], baud=mav_manager.baud)
        return JSONResponse(content={
            "status": "ok",
            "detected": detected_port,
            "connected": True,
            "message": f"Connecting to detected port {detected_port['device']}"
        })

    return JSONResponse(content={
        "status": "ok",
        "detected": detected_port,
        "is_connected": mav_manager.state.get("connected", False)
    })


@app.get("/api/telemetry")
@app.get("/api/connection/status")
@app.get("/api/status")
async def get_telemetry():
    """One-shot REST endpoint returning current telemetry state."""
    return JSONResponse(content=mav_manager.get_state())

@app.post("/api/connect")
async def connect_mavlink(req: ConnectRequest):
    """Dynamically reconnect MAVLink listener to target connection string & baud."""
    mav_manager.reconnect(connection_string=req.connection, baud=req.baud)
    return JSONResponse(content={"status": "ok", "message": f"Connecting to {req.connection}"})

@app.post("/api/disconnect")
async def disconnect_mavlink():
    """Explicitly disconnect MAVLink connection."""
    mav_manager.disconnect()
    return JSONResponse(content={"status": "ok", "message": "Disconnected"})

@app.post("/api/terminal/command")
async def execute_terminal_command(req: CommandRequest):
    """Executes a terminal command on MAVLink manager."""
    res = mav_manager.send_command(req.command)
    return JSONResponse(content=res)

@app.get("/api/terminal/logs")
async def get_terminal_logs():
    """Returns stored terminal logs buffer."""
    return JSONResponse(content=mav_manager.terminal_logs)

@app.get("/api/history/range")
async def get_history_range():
    """Returns timestamp range and entry count for logged telemetry in DB."""
    return JSONResponse(content=db.get_time_range())

@app.get("/api/history")
async def get_history(start: float = Query(..., description="Start timestamp"),
                      end: float = Query(..., description="End timestamp"),
                      limit: int = Query(1000, description="Max points to return")):
    """Returns historical telemetry data points from SQLite database."""
    history = db.get_history(start_ts=start, end_ts=end, limit=limit)
    return JSONResponse(content=history)

@app.get("/api/mission/download")
async def download_mission():
    """Triggers MAVLink mission download from flight controller."""
    mission_items = mav_manager.request_mission()
    return JSONResponse(content={"status": "ok", "items": mission_items})

def generate_mjpeg_stream(stream_url: str):
    """Decodes video stream (RTSP/HTTP/UDP/Webcam/Sim) via OpenCV and yields MJPEG frames for browser display."""
    target_clean = stream_url.strip()
    
    # Check if target is test pattern or simulation
    if target_clean in ["sim", "test", "simulated"]:
        t = 0.0
        while True:
            t += 0.05
            img = np.zeros((480, 640, 3), dtype=np.uint8)
            # Background dynamic pattern
            for y in range(0, 480, 4):
                img[y:y+4, :, 0] = int(25 + 15 * math.sin(t + y * 0.01))
                img[y:y+4, :, 1] = int(15 + 10 * math.cos(t))
                img[y:y+4, :, 2] = int(45 + 25 * math.sin(t))

            # Crosshair & HUD
            cv2.line(img, (320, 0), (320, 480), (0, 243, 255), 1)
            cv2.line(img, (0, 240), (640, 240), (0, 243, 255), 1)

            cx = int(320 + 180 * math.sin(t * 0.7))
            cy = int(240 + 90 * math.cos(t * 1.1))
            cv2.circle(img, (cx, cy), 22, (0, 255, 0), 2)
            cv2.line(img, (cx - 30, cy), (cx + 30, cy), (0, 255, 0), 2)
            cv2.line(img, (cx, cy - 30), (cx, cy + 30), (0, 255, 0), 2)

            cv2.putText(img, "FALCONZ SIMULATED CAMERA FEED", (30, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 243, 255), 2)
            cv2.putText(img, f"STREAM: MJPEG 640x480 | TIME: {time.strftime('%H:%M:%S')}", (30, 440), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

            ret, buffer = cv2.imencode('.jpg', img)
            if ret:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            time.sleep(0.04)

    # Standard OpenCV VideoCapture (handles RTSP, HTTP, UDP, Webcams, TrueView IP)
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;2000000;timeout;2000000"
    targets_to_try = [target_clean]
    
    # If user provided a raw IP like 172.16.23.19, auto-format common TrueView / RTSP IP camera URLs
    if not target_clean.isdigit() and "://" not in target_clean:
        targets_to_try = [
            f"rtsp://{target_clean}:554/live",
            f"rtsp://admin:admin@{target_clean}:554/live",
            f"rtsp://admin:123456@{target_clean}:554/live",
            f"rtsp://admin:admin@{target_clean}:554/ch0_0.264",
            f"rtsp://{target_clean}:554/stream1",
            f"rtsp://{target_clean}:554/h264Preview_01_main",
            f"http://{target_clean}:8080/video",
            f"http://{target_clean}/video",
            f"http://{target_clean}/mjpeg",
            target_clean
        ]

    cap = None
    successful_target = None
    for t_url in targets_to_try:
        try:
            capture_target = int(t_url) if t_url.isdigit() else t_url
            c = cv2.VideoCapture(capture_target)
            if c.isOpened():
                # Read 1 test frame to verify connection
                ret, _ = c.read()
                if ret:
                    cap = c
                    successful_target = t_url
                    logger.info(f"Successfully connected camera stream to target: {t_url}")
                    break
            c.release()
        except Exception:
            pass

    if not cap or not cap.isOpened():
        logger.warning(f"Could not open camera stream target: {target_clean}")
        t = 0.0
        # Yield dynamic HUD status overlay frame so browser player receives active live video stream
        while True:
            t += 0.05
            img = np.zeros((480, 640, 3), dtype=np.uint8)
            # Dynamic grid lines
            for y in range(0, 480, 40):
                cv2.line(img, (0, y), (640, y), (20, 25, 45), 1)
            for x in range(0, 640, 40):
                cv2.line(img, (x, 0), (x, 480), (20, 25, 45), 1)

            cv2.rectangle(img, (20, 20), (620, 460), (0, 243, 255), 2)
            cv2.putText(img, "TRUEVIEW / IP CAMERA STREAM", (40, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 243, 255), 2)
            cv2.putText(img, f"TARGET IP: {target_clean}", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            
            pulse = int(127 + 127 * math.sin(t * 3))
            cv2.putText(img, "STATUS: SEARCHING FOR TRUEVIEW IP STREAM...", (40, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, pulse, 255), 2)
            cv2.putText(img, "PROTOCOL: RTSP (554) / HTTP (8080) AUTO-DISCOVERY", (40, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)
            
            # Crosshair center
            cv2.circle(img, (320, 240), 15, (0, 243, 255), 1)
            cv2.line(img, (300, 240), (340, 240), (0, 243, 255), 1)
            cv2.line(img, (320, 220), (320, 260), (0, 243, 255), 1)

            cv2.putText(img, f"LIVE GCS FEED | TIME: {time.strftime('%H:%M:%S')}", (40, 430), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 136), 1)

            ret, buffer = cv2.imencode('.jpg', img)
            if ret:
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            time.sleep(0.05)

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.05)
                continue

            if frame.shape[1] > 1280:
                frame = cv2.resize(frame, (1280, 720))

            # Add TrueView IP HUD overlay on live video stream
            cv2.putText(frame, f"TRUEVIEW IP: {successful_target}", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

            ret, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if not ret:
                continue

            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            time.sleep(0.033)  # ~30 FPS
    except Exception as e:
        logger.error(f"Error in stream loop for {target_clean}: {e}")
    finally:
        if cap:
            cap.release()

@app.get("/api/camera/stream")
async def get_camera_stream(url: str = Query("sim", description="VLC IP / RTSP / HTTP stream target")):
    """Transcodes RTSP / VLC / IP network camera feed to MJPEG stream for live browser playback."""
    return StreamingResponse(generate_mjpeg_stream(url), media_type="multipart/x-mixed-replace; boundary=frame")

if __name__ == "__main__":
    logger.info(f"Launching APM Dashboard server on http://{args.host}:{args.port}")
    uvicorn.run("main:app", host=args.host, port=args.port, reload=False)
