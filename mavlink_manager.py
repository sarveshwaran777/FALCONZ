import threading
import time
import math
import logging
from typing import Dict, Any, Optional, List
from pymavlink import mavutil

logger = logging.getLogger("MAVLinkManager")

# Map GPS fix enum values to user-readable strings
GPS_FIX_TYPES = {
    0: "No GPS",
    1: "No Fix",
    2: "2D Fix",
    3: "3D Fix",
    4: "DGPS",
    5: "RTK Float",
    6: "RTK Fixed",
    7: "Static",
    8: "PPP"
}

# Map MAV_TYPE to human-readable strings safely
def _get_mav_types():
    types = {
        getattr(mavutil.mavlink, 'MAV_TYPE_GENERIC', 0): "Generic Vehicle",
        getattr(mavutil.mavlink, 'MAV_TYPE_FIXED_WING', 1): "Fixed Wing (Plane)",
        getattr(mavutil.mavlink, 'MAV_TYPE_QUADROTOR', 2): "Quadrotor",
        getattr(mavutil.mavlink, 'MAV_TYPE_COAXIAL', 3): "Coaxial",
        getattr(mavutil.mavlink, 'MAV_TYPE_HELICOPTER', 4): "Helicopter",
        getattr(mavutil.mavlink, 'MAV_TYPE_ANTENNA_TRACKER', 5): "Antenna Tracker",
        getattr(mavutil.mavlink, 'MAV_TYPE_GCS', 6): "GCS",
        getattr(mavutil.mavlink, 'MAV_TYPE_AIRSHIP', 7): "Airship",
        getattr(mavutil.mavlink, 'MAV_TYPE_FREE_BALLOON', 8): "Free Balloon",
        getattr(mavutil.mavlink, 'MAV_TYPE_ROCKET', 9): "Rocket",
        getattr(mavutil.mavlink, 'MAV_TYPE_GROUND_ROVER', 10): "Ground Rover",
        getattr(mavutil.mavlink, 'MAV_TYPE_SURFACE_BOAT', 11): "Surface Boat",
        getattr(mavutil.mavlink, 'MAV_TYPE_SUBMARINE', 12): "Submarine",
        getattr(mavutil.mavlink, 'MAV_TYPE_HEXAROTOR', 13): "Hexarotor",
        getattr(mavutil.mavlink, 'MAV_TYPE_OCTOROTOR', 14): "Octorotor",
        getattr(mavutil.mavlink, 'MAV_TYPE_TRICOPTER', 15): "Tricopter",
        getattr(mavutil.mavlink, 'MAV_TYPE_FLAPPING_WING', 16): "Flapping Wing",
    }
    for attr, name in [
        ('MAV_TYPE_VTOL_TAILSITTER_DUOROTOR', "VTOL Tailsitter"),
        ('MAV_TYPE_VTOL_TILTROTOR', "VTOL Tiltrotor"),
        ('MAV_TYPE_VTOL_FIXEDWING', "VTOL Fixedwing"),
        ('MAV_TYPE_DODECAROTOR', "Dodecarotor")
    ]:
        if hasattr(mavutil.mavlink, attr):
            types[getattr(mavutil.mavlink, attr)] = name
    return types

MAV_TYPES = _get_mav_types()

class MAVLinkManager:
    def __init__(self, connection_string: str = "udp:127.0.0.1:14550", baud: int = 57600, db_instance=None):
        self.connection_string = connection_string
        self.baud = baud
        self.db = db_instance
        self.mav_conn: Optional[mavutil.mavfile] = None
        self.running = False
        self.is_connected_requested = True  # Auto-connect to requested connection string on startup
        self.thread: Optional[threading.Thread] = None
        self.lock = threading.Lock()
        self.last_msg_time = 0.0
        self.last_log_time = 0.0
        self.last_heartbeat_sent_time = 0.0
        self.last_stream_req_time = 0.0
        self.terminal_logs: List[Dict[str, Any]] = []
        self.last_sent_log_idx = 0

        # Shared state dictionary
        self.state: Dict[str, Any] = {
            "connected": False,
            "timestamp": None,
            "connection_string": connection_string,
            "baud": baud,
            "system_id": None,
            "component_id": None,
            "vehicle_type": "Unknown",
            "terminal_logs": [],
            "heartbeat": {
                "mode": "UNKNOWN",
                "armed": False,
                "system_status": "UNKNOWN",
                "mavtype": "UNKNOWN"
            },
            "attitude": {
                "roll": None,
                "pitch": None,
                "yaw": None
            },
            "position": {
                "lat": None,
                "lon": None,
                "alt": None,
                "rel_alt": None,
                "heading": None
            },
            "vfr_hud": {
                "airspeed": None,
                "groundspeed": None,
                "heading": None,
                "throttle": None,
                "alt": None,
                "climb": None
            },
            "battery": {
                "voltage": None,
                "current": None,
                "remaining": None
            },
            "gps": {
                "fix_type": "No GPS",
                "fix_type_id": 0,
                "satellites_visible": None,
                "hdop": None,
                "lat": None,
                "lon": None,
                "alt": None
            },
            "rc_channels": [None] * 8,
            "servo_outputs": [None] * 8,
            "radio_status": {"rssi": None, "remrssi": None, "txbuf": None, "noise": None, "remnoise": None, "rxerrors": None, "fixed": None},
            "mission": []
        }

        self.add_terminal_log(f"MAVLink GCS Standby. Enter connection string and click CONNECT to establish link.", "system")

    def reset_telemetry_state(self):
        """Reset state telemetry metrics to disconnected defaults."""
        self.state["connected"] = False
        self.state["timestamp"] = None
        self.state["system_id"] = None
        self.state["component_id"] = None
        self.state["vehicle_type"] = "Unknown"
        self.state["heartbeat"] = {"mode": "STANDBY", "armed": False, "system_status": "DISCONNECTED", "mavtype": "UNKNOWN"}
        self.state["attitude"] = {"roll": None, "pitch": None, "yaw": None}
        self.state["position"] = {"lat": None, "lon": None, "alt": None, "rel_alt": None, "heading": None}
        self.state["vfr_hud"] = {"airspeed": None, "groundspeed": None, "heading": None, "throttle": None, "alt": None, "climb": None}
        self.state["battery"] = {"voltage": None, "current": None, "remaining": None}
        self.state["gps"] = {"fix_type": "No GPS", "fix_type_id": 0, "satellites_visible": None, "hdop": None, "lat": None, "lon": None, "alt": None}
        self.state["rc_channels"] = [None] * 8
        self.state["servo_outputs"] = [None] * 8
        self.state["radio_status"] = {"rssi": None, "remrssi": None, "txbuf": None, "noise": None, "remnoise": None, "rxerrors": None, "fixed": None}

    def add_terminal_log(self, message: str, level: str = "info", source: str = "GCS"):
        """Append a message to the in-memory terminal log buffer."""
        now = time.time()
        entry = {
            "timestamp": now,
            "time_str": time.strftime("%H:%M:%S", time.localtime(now)),
            "message": message,
            "level": level,
            "source": source
        }
        with self.lock:
            # Avoid duplicate logs if identical message arrived within 0.2s
            if self.terminal_logs:
                last = self.terminal_logs[-1]
                if last["message"] == message and (entry["timestamp"] - last["timestamp"] < 0.2):
                    return
            self.terminal_logs.append(entry)
            if len(self.terminal_logs) > 300:
                self.terminal_logs.pop(0)

    def reconnect(self, connection_string: str, baud: int = 57600):
        """Disconnect current endpoint and connect to new connection string."""
        conn_to_close = None
        with self.lock:
            self.connection_string = connection_string
            self.baud = baud
            self.state["connection_string"] = connection_string
            self.state["baud"] = baud
            self.is_connected_requested = True
            conn_to_close = self.mav_conn
            self.mav_conn = None
            self.reset_telemetry_state()

        if conn_to_close:
            try:
                conn_to_close.close()
            except Exception:
                pass

        self.add_terminal_log(f"Connecting MAVLink to {connection_string} @ {baud} baud...", "warn")
        logger.info(f"Connecting MAVLink to {connection_string} @ {baud}")

    def disconnect(self):
        """Explicitly disconnect current MAVLink connection."""
        conn_to_close = None
        with self.lock:
            self.is_connected_requested = False
            conn_to_close = self.mav_conn
            self.mav_conn = None
            self.reset_telemetry_state()

        if conn_to_close:
            try:
                conn_to_close.close()
            except Exception:
                pass

        self.add_terminal_log("MAVLink connection disconnected by user.", "error")
        logger.info("MAVLink connection explicitly disconnected.")

    def send_command(self, cmd_text: str) -> Dict[str, Any]:
        """Parse and execute terminal GCS command."""
        cmd_text = cmd_text.strip()
        if not cmd_text:
            return {"status": "error", "message": "Empty command"}

        self.add_terminal_log(f"> {cmd_text}", "cmd")
        parts = cmd_text.split()
        cmd_name = parts[0].upper()

        if cmd_name == "CONNECT":
            conn_str = parts[1] if len(parts) > 1 else self.connection_string
            baud_val = int(parts[2]) if len(parts) > 2 else self.baud
            self.reconnect(conn_str, baud_val)
            return {"status": "ok", "message": f"Connecting to {conn_str}"}

        if cmd_name == "DISCONNECT":
            self.disconnect()
            return {"status": "ok", "message": "Disconnected"}

        if not self.mav_conn or not self.state["connected"]:
            msg = f"Cannot execute '{cmd_name}': MAVLink is disconnected."
            self.add_terminal_log(msg, "error")
            return {"status": "error", "message": msg}

        target_sys = self.state.get("system_id", 1) or 1
        target_comp = self.state.get("component_id", 1) or 1

        try:
            if cmd_name == "ARM":
                self.mav_conn.mav.command_long_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                    0, 1, 0, 0, 0, 0, 0, 0
                )
                self.add_terminal_log("Sent ARM command to vehicle.", "info")
                return {"status": "ok", "message": "ARM command sent"}

            elif cmd_name == "DISARM":
                self.mav_conn.mav.command_long_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                    0, 0, 0, 0, 0, 0, 0, 0
                )
                self.add_terminal_log("Sent DISARM command to vehicle.", "warn")
                return {"status": "ok", "message": "DISARM command sent"}

            elif cmd_name == "TAKEOFF":
                alt = float(parts[1]) if len(parts) > 1 else 10.0
                self.mav_conn.mav.command_long_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                    0, 0, 0, 0, 0, 0, 0, alt
                )
                self.add_terminal_log(f"Sent TAKEOFF command (target alt {alt}m).", "info")
                return {"status": "ok", "message": f"TAKEOFF {alt}m command sent"}

            elif cmd_name in ["RTL", "RETURN"]:
                self.mav_conn.mav.command_long_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
                    0, 0, 0, 0, 0, 0, 0, 0
                )
                self.add_terminal_log("Sent RTL (Return to Launch) command.", "warn")
                return {"status": "ok", "message": "RTL command sent"}

            elif cmd_name == "MODE":
                mode_str = parts[1].upper() if len(parts) > 1 else "GUIDED"
                if mode_str in self.mav_conn.mode_mapping():
                    mode_id = self.mav_conn.mode_mapping()[mode_str]
                    self.mav_conn.mav.set_mode_send(
                        target_sys,
                        mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                        mode_id
                    )
                    self.add_terminal_log(f"Requested vehicle mode change to {mode_str}.", "info")
                    return {"status": "ok", "message": f"Mode set to {mode_str}"}
                else:
                    valid_modes = ", ".join(list(self.mav_conn.mode_mapping().keys())[:10])
                    msg = f"Unknown mode '{mode_str}'. Available: {valid_modes}"
                    self.add_terminal_log(msg, "warn")
                    return {"status": "error", "message": msg}

            elif cmd_name in ["GUIDED", "AUTO", "STABILIZE", "ALT_HOLD", "LOITER", "POSHOLD", "LAND"]:
                if cmd_name in self.mav_conn.mode_mapping():
                    mode_id = self.mav_conn.mode_mapping()[cmd_name]
                    self.mav_conn.mav.set_mode_send(
                        target_sys,
                        mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                        mode_id
                    )
                    self.add_terminal_log(f"Set flight mode to {cmd_name}.", "info")
                    return {"status": "ok", "message": f"Mode set to {cmd_name}"}

            elif cmd_name in ["MISSION", "WAYPOINTS", "FETCH"]:
                self.request_mission()
                self.add_terminal_log(f"Requested mission waypoints from vehicle.", "info")
                return {"status": "ok", "message": "Mission requested"}

            elif cmd_name == "REBOOT":
                self.mav_conn.mav.command_long_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
                    0, 1, 0, 0, 0, 0, 0, 0
                )
                self.add_terminal_log("Sent Autopilot REBOOT command.", "error")
                return {"status": "ok", "message": "Reboot command sent"}

            else:
                msg = f"Unrecognized terminal command: '{cmd_name}'. Supported: ARM, DISARM, TAKEOFF [alt], RTL, MODE [mode], GUIDED, AUTO, STABILIZE, LAND, REBOOT, CONNECT, DISCONNECT"
                self.add_terminal_log(msg, "warn")
                return {"status": "error", "message": msg}

        except Exception as e:
            msg = f"Error executing '{cmd_text}': {e}"
            self.add_terminal_log(msg, "error")
            return {"status": "error", "message": msg}

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._read_loop, daemon=True)
        self.thread.start()
        logger.info(f"MAVLink manager started (Standby mode).")

    def stop(self):
        self.running = False
        self.disconnect()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)
        logger.info("MAVLink manager stopped.")

    def get_state(self) -> Dict[str, Any]:
        with self.lock:
            # Check watchdog timeout (3 seconds)
            now = time.time()
            if self.state["connected"] and (now - self.last_msg_time > 3.0):
                self.state["connected"] = False
            
            # Send only new terminal logs since last broadcast
            if self.last_sent_log_idx > len(self.terminal_logs):
                self.last_sent_log_idx = 0
            new_logs = self.terminal_logs[self.last_sent_log_idx:]
            self.last_sent_log_idx = len(self.terminal_logs)
            
            state_copy = dict(self.state)
            state_copy["terminal_logs"] = new_logs
            return state_copy

    def _read_loop(self):
        logger.info("MAVLink receive thread started. Standby until CONNECT requested.")
        while self.running:
            if not self.is_connected_requested:
                time.sleep(0.3)
                continue

            current_conn = None
            with self.lock:
                current_conn = self.mav_conn

            if not current_conn:
                try:
                    target_str = self.connection_string
                    if target_str.startswith("udp:"):
                        target_str = target_str.replace("udp:", "udpin:")

                    new_conn = mavutil.mavlink_connection(
                        target_str,
                        baud=self.baud,
                        autoreconnect=True
                    )
                    is_serial_conn = not target_str.startswith("udpin:") and not target_str.startswith("udp:")
                    with self.lock:
                        if self.is_connected_requested:
                            self.mav_conn = new_conn
                            current_conn = new_conn
                            self.state["is_serial"] = is_serial_conn
                        else:
                            new_conn.close()
                            continue
                    
                    conn_type_label = f"Direct Hardware Serial Telemetry Port ({self.connection_string})" if is_serial_conn else f"UDP Network/Sim Port ({self.connection_string})"
                    logger.info(f"MAVLink connection object initialized: {conn_type_label} @ {self.baud} baud")
                    self.add_terminal_log(f"Opened {conn_type_label} @ {self.baud} baud. Reading live telemetry...", "info")
                except Exception as e:
                    logger.error(f"Failed to create MAVLink connection to {self.connection_string}: {e}")
                    self.add_terminal_log(f"Connection error on {self.connection_string}: {e}", "error")
                    with self.lock:
                        self.reset_telemetry_state()
                    time.sleep(2.0)
                    continue

            try:
                now = time.time()

                # Send GCS Heartbeat to flight controller every 1s
                if now - self.last_heartbeat_sent_time >= 1.0:
                    self.last_heartbeat_sent_time = now
                    try:
                        current_conn.mav.heartbeat_send(
                            mavutil.mavlink.MAV_TYPE_GCS,
                            mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                            0, 0, 0
                        )
                    except Exception as hb_err:
                        logger.debug(f"GCS heartbeat send warning: {hb_err}")

                # Send Data Stream Request to flight controller every 3s
                if now - self.last_stream_req_time >= 3.0:
                    self.last_stream_req_time = now
                    try:
                        sys_id = self.state.get("system_id") or 1
                        comp_id = self.state.get("component_id") or 1
                        current_conn.mav.request_data_stream_send(
                            sys_id, comp_id,
                            mavutil.mavlink.MAV_DATA_STREAM_ALL,
                            6, 1
                        )
                    except Exception as req_err:
                        logger.debug(f"Data stream request warning: {req_err}")

                msg = current_conn.recv_match(blocking=True, timeout=0.5)
                if not self.is_connected_requested:
                    continue

                if msg is None:
                    with self.lock:
                        if self.state["connected"] and (now - self.last_msg_time > 3.0):
                            self.state["connected"] = False
                    continue

                # Process message
                self.last_msg_time = now
                self._handle_mavlink_msg(msg)

                # Periodic DB logging (~2 Hz = 0.5s interval)
                if self.db and (now - self.last_log_time >= 0.5):
                    self.last_log_time = now
                    current_snapshot = self.get_state()
                    if current_snapshot["connected"]:
                        self.db.log_telemetry(current_snapshot)

            except Exception as e:
                if self.is_connected_requested:
                    logger.warning(f"Error in MAVLink receive loop: {e}")
                    with self.lock:
                        if self.mav_conn == current_conn:
                            self.mav_conn = None
                        try:
                            current_conn.close()
                        except Exception:
                            pass
                        self.reset_telemetry_state()
                time.sleep(1.0)

    def add_terminal_log(self, message: str, level: str = "info", source: str = "GCS"):
        """Append a message to the in-memory terminal log buffer."""
        entry = {
            "timestamp": time.time(),
            "time_str": time.strftime("%H:%M:%S"),
            "message": message,
            "level": level,
            "source": source
        }
        with self.lock:
            # Avoid duplicate logs if identical message arrived within 0.2s
            if self.terminal_logs:
                last = self.terminal_logs[-1]
                if last["message"] == message and (entry["timestamp"] - last["timestamp"] < 0.2):
                    return
            self.terminal_logs.append(entry)
            if len(self.terminal_logs) > 300:
                self.terminal_logs.pop(0)

    def _handle_mavlink_msg(self, msg):
        msg_type = msg.get_type()
        now = time.time()

        with self.lock:
            self.state["connected"] = True
            self.state["timestamp"] = now
            self.state["system_id"] = msg.get_srcSystem()
            self.state["component_id"] = msg.get_srcComponent()

            if msg_type == "STATUSTEXT":
                text = getattr(msg, 'text', '')
                if isinstance(text, bytes):
                    text = text.decode('utf-8', errors='ignore')
                text = text.strip('\x00').strip()

                severity = getattr(msg, 'severity', 6)
                level_map = {
                    0: "error", # EMERGENCY
                    1: "error", # ALERT
                    2: "error", # CRITICAL
                    3: "error", # ERROR
                    4: "warn",  # WARNING
                    5: "warn",  # NOTICE
                    6: "info",  # INFO
                    7: "debug"  # DEBUG
                }
                lvl = level_map.get(severity, "info")
                
                # Append to terminal logs
                entry = {
                    "timestamp": now,
                    "time_str": time.strftime("%H:%M:%S", time.localtime(now)),
                    "message": f"[FC] {text}",
                    "level": lvl,
                    "source": "FC"
                }
                self.terminal_logs.append(entry)
                if len(self.terminal_logs) > 300:
                    self.terminal_logs.pop(0)

            elif msg_type == "COMMAND_ACK":
                cmd_id = getattr(msg, 'command', 'UNKNOWN')
                result_id = getattr(msg, 'result', 'UNKNOWN')
                ack_map = {
                    0: "ACCEPTED",
                    1: "TEMPORARILY_REJECTED",
                    2: "DENIED",
                    3: "UNSUPPORTED",
                    4: "FAILED",
                    5: "IN_PROGRESS"
                }
                res_str = ack_map.get(result_id, f"RESULT_{result_id}")
                lvl = "info" if res_str == "ACCEPTED" else "warn"
                
                entry = {
                    "timestamp": now,
                    "time_str": time.strftime("%H:%M:%S", time.localtime(now)),
                    "message": f"[ACK] Command #{cmd_id} -> {res_str}",
                    "level": lvl,
                    "source": "FC"
                }
                self.terminal_logs.append(entry)
                if len(self.terminal_logs) > 300:
                    self.terminal_logs.pop(0)

            elif msg_type == "HEARTBEAT":
                armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                mode_str = mavutil.mode_string_v10(msg)
                vehicle_type_str = MAV_TYPES.get(msg.type, f"Vehicle ({msg.type})")

                prev_hb = self.state.get("heartbeat", {})
                prev_armed = prev_hb.get("armed", False)
                prev_mode = prev_hb.get("mode", "")

                self.state["vehicle_type"] = vehicle_type_str
                self.state["heartbeat"] = {
                    "mode": mode_str.upper(),
                    "armed": armed,
                    "system_status": str(msg.system_status),
                    "mavtype": vehicle_type_str
                }

                # Log state changes
                if prev_armed != armed:
                    state_txt = "ARMED" if armed else "DISARMED"
                    lvl = "warn" if armed else "info"
                    self.terminal_logs.append({
                        "timestamp": now,
                        "time_str": time.strftime("%H:%M:%S", time.localtime(now)),
                        "message": f"[VEHICLE] Status changed: {state_txt}",
                        "level": lvl,
                        "source": "VEHICLE"
                    })
                if prev_mode and prev_mode != mode_str.upper():
                    self.terminal_logs.append({
                        "timestamp": now,
                        "time_str": time.strftime("%H:%M:%S", time.localtime(now)),
                        "message": f"[VEHICLE] Flight Mode set to {mode_str.upper()}",
                        "level": "info",
                        "source": "VEHICLE"
                    })

            elif msg_type == "ATTITUDE":
                self.state["attitude"] = {
                    "roll": round(math.degrees(msg.roll), 2),
                    "pitch": round(math.degrees(msg.pitch), 2),
                    "yaw": round((math.degrees(msg.yaw) + 360) % 360, 2)
                }

            elif msg_type == "GLOBAL_POSITION_INT":
                hdg = msg.hdg / 100.0 if msg.hdg != 65535 else None
                self.state["position"] = {
                    "lat": round(msg.lat / 1e7, 7),
                    "lon": round(msg.lon / 1e7, 7),
                    "alt": round(msg.alt / 1000.0, 2),        # MSL altitude in meters
                    "rel_alt": round(msg.relative_alt / 1000.0, 2), # Relative altitude in meters
                    "heading": round(hdg, 1) if hdg is not None else None
                }

            elif msg_type == "VFR_HUD":
                self.state["vfr_hud"] = {
                    "airspeed": round(msg.airspeed, 2),
                    "groundspeed": round(msg.groundspeed, 2),
                    "heading": msg.heading,
                    "throttle": msg.throttle,
                    "alt": round(msg.alt, 2),
                    "climb": round(msg.climb, 2)
                }

            elif msg_type == "SYS_STATUS":
                v_bat = msg.voltage_battery / 1000.0 if msg.voltage_battery != 65535 else None
                c_bat = msg.current_battery / 100.0 if msg.current_battery != -1 else None
                rem_bat = msg.battery_remaining if msg.battery_remaining != -1 else None
                self.state["battery"] = {
                    "voltage": round(v_bat, 2) if v_bat is not None else None,
                    "current": round(c_bat, 2) if c_bat is not None else None,
                    "remaining": rem_bat
                }

            elif msg_type == "GPS_RAW_INT":
                fix_str = GPS_FIX_TYPES.get(msg.fix_type, f"Fix {msg.fix_type}")
                hdop_val = msg.eph / 100.0 if msg.eph < 65535 else None
                self.state["gps"] = {
                    "fix_type": fix_str,
                    "fix_type_id": msg.fix_type,
                    "satellites_visible": msg.satellites_visible,
                    "hdop": round(hdop_val, 2) if hdop_val is not None else None,
                    "lat": round(msg.lat / 1e7, 7) if msg.lat != 0 else None,
                    "lon": round(msg.lon / 1e7, 7) if msg.lon != 0 else None,
                    "alt": round(msg.alt / 1000.0, 2) if msg.alt != 0 else None
                }

            elif msg_type == "RC_CHANNELS":
                chans = [
                    getattr(msg, f"chan{i}_raw", None)
                    for i in range(1, 9)
                ]
                # Filter out 65535 (undefined)
                self.state["rc_channels"] = [c if (c and c != 65535) else None for c in chans]

            elif msg_type == "SERVO_OUTPUT_RAW":
                servos = [
                    getattr(msg, f"servo{i}_raw", None)
                    for i in range(1, 9)
                ]
                self.state["servo_outputs"] = [s if (s and s != 65535) else None for s in servos]

            elif msg_type in ["RADIO_STATUS", "RADIO"]:
                self.state["radio_status"] = {
                    "rssi": getattr(msg, 'rssi', None),
                    "remrssi": getattr(msg, 'remrssi', None),
                    "txbuf": getattr(msg, 'txbuf', None),
                    "noise": getattr(msg, 'noise', None),
                    "remnoise": getattr(msg, 'remnoise', None),
                    "rxerrors": getattr(msg, 'rxerrors', None),
                    "fixed": getattr(msg, 'fixed', None)
                }

            elif msg_type == "BATTERY_STATUS":
                v_bat = getattr(msg, 'voltages', [0])[0] / 1000.0 if hasattr(msg, 'voltages') and msg.voltages and msg.voltages[0] != 65535 else None
                c_bat = getattr(msg, 'current_battery', -1) / 100.0 if getattr(msg, 'current_battery', -1) != -1 else None
                rem_bat = getattr(msg, 'battery_remaining', -1) if getattr(msg, 'battery_remaining', -1) != -1 else None
                self.state["battery"] = {
                    "voltage": round(v_bat, 2) if v_bat is not None else self.state["battery"]["voltage"],
                    "current": round(c_bat, 2) if c_bat is not None else self.state["battery"]["current"],
                    "remaining": rem_bat if rem_bat is not None else self.state["battery"]["remaining"]
                }

    def request_mission(self) -> List[Dict[str, Any]]:
        """Download waypoints from vehicle using MAVLink protocol."""
        if not self.mav_conn or not self.state["connected"]:
            return []

        try:
            logger.info("Requesting mission item count...")
            target_sys = self.state.get("system_id", 1) or 1
            target_comp = self.state.get("component_id", 1) or 1

            self.mav_conn.mav.mission_request_list_send(target_sys, target_comp)
            
            # Wait for MISSION_COUNT
            msg = self.mav_conn.recv_match(type=['MISSION_COUNT'], blocking=True, timeout=3.0)
            if not msg:
                logger.warning("No MISSION_COUNT response received.")
                return self.state["mission"]

            count = msg.count
            waypoints = []
            logger.info(f"Vehicle reports {count} mission items. Fetching...")

            for i in range(count):
                self.mav_conn.mav.mission_request_int_send(target_sys, target_comp, i)
                w_msg = self.mav_conn.recv_match(type=['MISSION_ITEM_INT', 'MISSION_ITEM'], blocking=True, timeout=3.0)
                if w_msg:
                    item = {
                        "seq": w_msg.seq,
                        "command": w_msg.command,
                        "frame": w_msg.frame,
                        "current": bool(w_msg.current),
                        "lat": (w_msg.x / 1e7) if hasattr(w_msg, 'x') and abs(w_msg.x) > 180 else getattr(w_msg, 'x', 0),
                        "lon": (w_msg.y / 1e7) if hasattr(w_msg, 'y') and abs(w_msg.y) > 180 else getattr(w_msg, 'y', 0),
                        "alt": getattr(w_msg, 'z', 0)
                    }
                    waypoints.append(item)

            with self.lock:
                self.state["mission"] = waypoints

            # Send ACK
            self.mav_conn.mav.mission_ack_send(target_sys, target_comp, mavutil.mavlink.MAV_MISSION_ACCEPTED)
            return waypoints

        except Exception as e:
            logger.error(f"Error requesting mission: {e}")
            return self.state["mission"]
