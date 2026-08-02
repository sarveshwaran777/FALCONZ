"""
FALCONZ AI Copilot — Universal Aerospace RAG Engine
Self-contained, zero-dependency semantic retrieval and telemetry-augmented reasoning engine.
"""

import math
import re
import time
from typing import List, Dict, Any, Tuple

class RAGEngine:
    """
    RAG Engine that indexes MAVLink parameter definitions, universal flight manuals,
    calibration steps, and safety guidelines for all flight controllers (ArduPilot, PX4, INAV, Betaflight).
    Synthesizes custom responses tailored to specific user queries and live telemetry state.
    """

    def __init__(self):
        self.documents: List[Dict[str, Any]] = []
        self._load_knowledge_base()

    def _load_knowledge_base(self):
        """Populates the knowledge base with curated universal aerospace documentation."""
        self.documents = [
            # Flight Modes
            {
                "id": "mode_guided",
                "category": "Flight Modes",
                "title": "GUIDED / GOTO Mode",
                "keywords": ["guided", "goto", "waypoint", "autonomous", "navigation", "position hold", "fly to"],
                "content": (
                    "GUIDED mode commands the vehicle to navigate dynamically to target coordinates or follow waypoints "
                    "sent from the GCS. Requires an active 3D GPS fix (HDOP < 2.0). The flight controller automatically manages "
                    "throttle, pitch, roll, and heading to reach target locations."
                ),
                "recommendations": "Verify GPS 3D Fix quality and Home coordinate location before commanding GUIDED waypoints."
            },
            {
                "id": "mode_rtl",
                "category": "Flight Modes",
                "title": "RTL (Return To Launch) Mode",
                "keywords": ["rtl", "return to launch", "rth", "failsafe", "home", "land", "emergency", "return home"],
                "content": (
                    "RTL (Return to Launch / Return to Home) mode commands the aircraft to climb to a safe obstacle-clearing altitude "
                    "(typically 15m to 30m), navigate back to the launch coordinates, loiter, and automatically land. "
                    "Triggered automatically upon battery failsafe or telemetry signal loss."
                ),
                "recommendations": "Ensure home location is set on the map before arming and takeoff."
            },
            {
                "id": "mode_stabilize",
                "category": "Flight Modes",
                "title": "STABILIZE / Manual Self-Leveling Mode",
                "keywords": ["stabilize", "manual", "self leveling", "roll", "pitch", "throttle", "acro"],
                "content": (
                    "STABILIZE mode provides manual flight control with automatic self-leveling of roll and pitch axes. "
                    "Throttle is controlled directly by the pilot without automatic altitude holding."
                ),
                "recommendations": "Maintain active pilot throttle input to prevent sudden altitude drops in STABILIZE mode."
            },
            {
                "id": "mode_poshold",
                "category": "Flight Modes",
                "title": "POSHOLD / LOITER Mode",
                "keywords": ["poshold", "loiter", "position hold", "hover", "brake", "hold position", "gps hold"],
                "content": (
                    "POSHOLD / LOITER mode uses optical flow, barometer, and GPS positioning to maintain hover location "
                    "and altitude when pilot controls are centered. Releasing control sticks automatically brakes and holds position."
                ),
                "recommendations": "Requires HDOP < 2.0 for stable hover. If the vehicle twitches or toilet-bowls, perform compass calibration."
            },
            {
                "id": "mode_offboard",
                "category": "Flight Modes",
                "title": "OFFBOARD / Companion Control Mode",
                "keywords": ["offboard", "companion", "ros", "ros2", "mavlink", "sdk", "autonomous", "px4"],
                "content": (
                    "OFFBOARD mode delegates setpoint generation (position, velocity, attitude rates) to an onboard companion computer "
                    "(e.g., Raspberry Pi, NVIDIA Jetson) over MAVLink or ROS2 node connections."
                ),
                "recommendations": "Ensure companion computer streams heartbeats at minimum 2 Hz before switching to OFFBOARD."
            },
            {
                "id": "mode_auto",
                "category": "Flight Modes",
                "title": "AUTO / Mission Mode",
                "keywords": ["auto", "mission", "waypoints", "flight plan", "autonomous", "survey"],
                "content": (
                    "AUTO mode executes pre-programmed mission waypoints stored in the flight controller EEPROM. "
                    "Executes TAKEOFF, WAYPOINT, LOITER_TURNS, ROI, and RTL commands sequentially."
                ),
                "recommendations": "Verify mission waypoints and altitude profiles in GCS before switching to AUTO."
            },

            # Calibration & Hardware
            {
                "id": "cal_accel",
                "category": "Calibration",
                "title": "6-Axis Accelerometer Calibration",
                "keywords": ["accel", "accelerometer", "calibration", "level", "gravity", "imu", "orientation", "trim"],
                "content": (
                    "Accelerometer calibration aligns IMU sensor axes with earth's gravity. The procedure requires positioning "
                    "the aircraft in 6 stationary orientations: 1. Level, 2. Left Side, 3. Right Side, 4. Nose Down, 5. Nose Up, 6. Inverted."
                ),
                "recommendations": "Keep the flight controller strictly motionless during each sampling step."
            },
            {
                "id": "cal_compass",
                "category": "Calibration",
                "title": "3D Compass (Magnetometer) Calibration",
                "keywords": ["compass", "mag", "magnetometer", "sphere", "iron", "heading", "declination", "interference", "toilet bowl"],
                "content": (
                    "Compass calibration measures hard-iron and soft-iron magnetic interference from onboard electronics and motors. "
                    "Requires rotating the aircraft 360 degrees along all axes outdoors away from metallic objects."
                ),
                "recommendations": "Perform compass calibration outdoors away from laptop batteries, vehicles, and concrete reinforced rebar."
            },
            {
                "id": "cal_rc",
                "category": "Calibration",
                "title": "RC Receiver & Radio PWM Calibration",
                "keywords": ["rc", "radio", "receiver", "pwm", "stick", "transmitter", "channel", "throttle", "yaw", "pitch", "roll"],
                "content": (
                    "RC calibration maps pilot transmitter stick movements (Channels 1-8) to minimum (1000us), neutral (1500us), "
                    "and maximum (2000us) PWM signal thresholds in the flight controller."
                ),
                "recommendations": "Ensure transmitter trims are centered and failsafe behavior is tested prior to first flight."
            },

            # Power & Battery Systems
            {
                "id": "power_battery",
                "category": "Power & Battery",
                "title": "Battery Voltage & Failsafe Thresholds",
                "keywords": ["battery", "voltage", "current", "lipo", "failsafe", "power", "cell", "mah", "discharge", "charging"],
                "content": (
                    "Monitors propulsion battery voltage and current draw. For 4S LiPo batteries: Full = 16.8V (4.2V/cell), "
                    "Nominal = 14.8V (3.7V/cell), Low Warning = 14.0V (3.5V/cell), Critical Failsafe = 13.6V (3.4V/cell)."
                ),
                "recommendations": "Land immediately when battery remaining drops below 25% or cell voltage falls below 3.5V."
            },

            # GPS & Navigation
            {
                "id": "gps_quality",
                "category": "GPS & Navigation",
                "title": "GPS Fix Types & HDOP Metrics",
                "keywords": ["gps", "hdop", "satellites", "sats", "fix", "rtk", "3d fix", "navigation", "location", "accuracy"],
                "content": (
                    "GPS Fix status defines 3D position accuracy: 0-1 = No Fix, 2 = 2D Fix, 3 = 3D Fix, 4 = DGPS, 5 = RTK Float, 6 = RTK Fixed. "
                    "HDOP (Horizontal Dilution of Precision) measures satellite geometry quality (HDOP < 1.5 = Excellent, < 2.0 = Good)."
                ),
                "recommendations": "Require minimum 8 visible satellites and HDOP < 2.0 before engaging autonomous modes."
            },

            # Universal Flight Controller Support
            {
                "id": "fc_compatibility",
                "category": "Flight Controller Architecture",
                "title": "Universal Autopilot & Connection Setup",
                "keywords": ["flight controller", "autopilot", "px4", "ardupilot", "apm", "inav", "betaflight", "mavlink", "telemetry", "connection", "port", "baud", "serial", "udp", "com"],
                "content": (
                    "FALCONZ supports all major open-source and enterprise flight controllers via MAVLink v1.0 and v2.0 protocols. "
                    "Connect via UDP (127.0.0.1:14550), Serial COM ports (57600/115200 baud), or TCP sockets for ArduPilot, PX4, and INAV."
                ),
                "recommendations": "Use 57600 baud for 915MHz/433MHz telemetry radios, and 115200 or 921600 baud for direct USB flight controllers."
            },

            # Telemetry & VFR HUD
            {
                "id": "telemetry_hud",
                "category": "Telemetry & Speed",
                "title": "VFR HUD Metrics & Instrument Interpretation",
                "keywords": ["speed", "groundspeed", "airspeed", "climb", "throttle", "altitude", "heading", "vfr", "hud", "pfd"],
                "content": (
                    "VFR HUD displays primary flight metrics: Groundspeed (GPS speed over ground), Airspeed (pitot tube airspeed), "
                    "Climb Rate (m/s vertical rate), Throttle %, and Relative Altitude (height above takeoff home position)."
                ),
                "recommendations": "Monitor climb rate during manual descent to prevent vortex ring state (keep descent rate < 2.5 m/s)."
            },

            # Computer Vision & Camera
            {
                "id": "camera_vision",
                "category": "Computer Vision",
                "title": "Real-Time OpenCV & ORB Feature Tracking",
                "keywords": ["camera", "video", "vision", "orb", "opencv", "feature", "tracking", "stream", "feed"],
                "content": (
                    "FALCONZ integrates live video streaming with OpenCV camera pipelines and dynamic ORB (Oriented FAST and Rotated BRIEF) "
                    "feature detection overlay for visual odometry and feature tracking analysis."
                ),
                "recommendations": "Toggle ORB Feature Overlay in Camera View to inspect real-time visual tracking points."
            }
        ]

        # Synonym expansion mapping for intelligent query understanding
        self.synonyms = {
            "battery": ["battery", "voltage", "power", "lipo", "cell", "current", "mah"],
            "speed": ["speed", "groundspeed", "airspeed", "velocity", "fast", "vfr"],
            "gps": ["gps", "hdop", "satellite", "satellites", "sats", "fix", "location", "navigation", "map", "position"],
            "arm": ["arm", "armed", "arming", "disarm", "pre-arm", "motor", "takeoff"],
            "mode": ["mode", "guided", "rtl", "stabilize", "auto", "poshold", "loiter", "offboard", "althold"],
            "calibrate": ["calibrate", "calibration", "accel", "compass", "mag", "level", "imu", "radio", "rc"],
            "connect": ["connect", "connection", "port", "baud", "serial", "udp", "com", "usb"],
            "camera": ["camera", "video", "vision", "orb", "stream", "feed", "opencv"]
        }

    def _tokenize(self, text: str) -> List[str]:
        """Cleans and tokenizes text into lowercase words."""
        return re.findall(r'\w+', text.lower())

    def _expand_tokens(self, tokens: List[str]) -> List[str]:
        """Expands query tokens with relevant aerospace synonyms."""
        expanded = set(tokens)
        for token in tokens:
            for key, synonym_list in self.synonyms.items():
                if token in synonym_list or token == key:
                    expanded.update(synonym_list)
        return list(expanded)

    def _score_document(self, query_tokens: List[str], doc: Dict[str, Any]) -> float:
        """Computes keyword overlap and relevance score for a document."""
        expanded_tokens = self._expand_tokens(query_tokens)
        doc_keywords = set(doc['keywords'])
        doc_title_tokens = set(self._tokenize(doc['title']))
        doc_text = f"{doc['title']} {doc['category']} {' '.join(doc['keywords'])} {doc['content']}".lower()

        score = 0.0
        for token in query_tokens:
            if len(token) < 2:
                continue
            if token in doc_keywords:
                score += 4.5
            if token in doc_title_tokens:
                score += 4.0
            if token in doc_text:
                score += 1.5

        for token in expanded_tokens:
            if token in doc_keywords:
                score += 1.0

        return score

    def search(self, user_query: str, top_k: int = 2) -> List[Tuple[float, Dict[str, Any]]]:
        """Retrieves top_k most relevant knowledge base documents with scores."""
        tokens = self._tokenize(user_query)
        if not tokens:
            return []

        scored_docs = []
        for doc in self.documents:
            score = self._score_document(tokens, doc)
            if score > 0:
                scored_docs.append((score, doc))

        scored_docs.sort(key=lambda x: x[0], reverse=True)
        return scored_docs[:top_k]

    def query(self, user_query: str, telemetry_state: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Executes Retrieval-Augmented Generation:
        1. Analyzes user query tokens and expands aerospace synonyms
        2. Retrieves relevant documents from knowledge base
        3. Fuses live MAVLink telemetry context (battery, GPS, flight mode, armed status)
        4. Synthesizes a unique, context-aware answer tailored specifically to the query
        """
        user_query_clean = user_query.strip()
        tokens = self._tokenize(user_query_clean)
        top_matches = self.search(user_query_clean, top_k=2)

        # Extract Live Telemetry Context
        telem_ctx = {}
        status_alerts = []

        if telemetry_state:
            hb = telemetry_state.get("heartbeat", {})
            pos = telemetry_state.get("position", {})
            bat = telemetry_state.get("battery", {})
            gps = telemetry_state.get("gps", {})
            vfr = telemetry_state.get("vfr_hud", {})

            telem_ctx = {
                "connected": telemetry_state.get("connected", False),
                "armed": hb.get("armed", False),
                "mode": hb.get("mode", "STANDBY"),
                "altitude_m": round(pos.get("alt", 0.0) or 0.0, 1),
                "rel_alt_m": round(pos.get("rel_alt", 0.0) or 0.0, 1),
                "voltage_v": round(bat.get("voltage", 0.0) or 0.0, 2),
                "battery_pct": bat.get("remaining", 0) or 0,
                "gps_fix": gps.get("fix_type", "No GPS"),
                "sats": gps.get("satellites_visible", 0) or 0,
                "hdop": round(gps.get("hdop", 0.0) or 0.0, 2),
                "groundspeed_ms": round(vfr.get("groundspeed", 0.0) or 0.0, 1),
                "airspeed_ms": round(vfr.get("airspeed", 0.0) or 0.0, 1),
                "climb_ms": round(vfr.get("climb", 0.0) or 0.0, 1)
            }

            # Generate real-time telemetry alerts
            if telem_ctx["battery_pct"] > 0 and telem_ctx["battery_pct"] <= 25:
                status_alerts.append(f"⚠️ LOW BATTERY WARNING: {telem_ctx['battery_pct']}% remaining ({telem_ctx['voltage_v']}V)")
            if telem_ctx["hdop"] > 2.5:
                status_alerts.append(f"⚠️ POOR GPS QUALITY: HDOP is {telem_ctx['hdop']} (Recommend < 2.0)")
            if telem_ctx["armed"]:
                status_alerts.append(f"⚡ VEHICLE IS ARMED ({telem_ctx['mode']} Mode)")

        # Synthesize Dynamic Answer Based on Query Type and Matches
        sources = []
        answer_parts = []

        if top_matches and top_matches[0][0] > 1.5:
            # We have high-confidence doc matches! Build query-specific response
            primary_score, primary_doc = top_matches[0]
            answer_parts.append(f"### 💡 {primary_doc['title']}")
            answer_parts.append(primary_doc['content'])
            answer_parts.append(f"**Actionable Advice**: {primary_doc['recommendations']}")

            sources.append({
                "id": primary_doc["id"],
                "title": primary_doc["title"],
                "category": primary_doc["category"]
            })

            # If second match is strong, include it as supplementary reference
            if len(top_matches) > 1 and top_matches[1][0] > 2.0:
                sec_score, sec_doc = top_matches[1]
                answer_parts.append(f"\n**Related Subject — {sec_doc['title']}**:\n{sec_doc['content']}")
                sources.append({
                    "id": sec_doc["id"],
                    "title": sec_doc["title"],
                    "category": sec_doc["category"]
                })

        else:
            # General query / Greetings / Unmatched Question: Provide intelligent Copilot response
            q_lower = user_query_clean.lower()
            if any(greeting in q_lower for greeting in ["hi", "hello", "hey", "who are you", "what can you do", "help"]):
                answer_parts.append("### 🛸 Welcome to FALCONZ AI Copilot!")
                answer_parts.append(
                    "I am your real-time aerospace diagnostic assistant. I monitor your live MAVLink telemetry stream "
                    "and cross-reference technical manuals for **ArduPilot, PX4, INAV, Betaflight, and custom flight controllers**."
                )
                answer_parts.append(
                    "**You can ask me questions like:**\n"
                    "• *Why is my drone refusing to arm?*\n"
                    "• *How do I perform a 3D compass or 6-axis accelerometer calibration?*\n"
                    "• *What does GPS HDOP mean for GUIDED or AUTO modes?*\n"
                    "• *What are the safe LiPo battery voltage thresholds?*\n"
                    "• *How do I connect via serial COM port or UDP port 14550?*"
                )
            else:
                answer_parts.append(f"### 🤖 FALCONZ Diagnostic Analysis for: \"{user_query_clean}\"")
                answer_parts.append(
                    f"I evaluated your query against FALCONZ Aerospace knowledge bases. While no exact parameter manual entry matched "
                    f"\"{user_query_clean}\", I am actively monitoring your flight controller telemetry stream."
                )
                answer_parts.append(
                    "**Recommended Next Steps:**\n"
                    "1. Check the **Telemetry Cards** for active flight mode, battery voltage, and GPS satellite count.\n"
                    "2. Use the **Calibration** menu for 6-axis accelerometer or 3D compass setup.\n"
                    "3. Open the **Full Inspector** tab to view raw time-series telemetry streams and error flags."
                )

        # Append Live Telemetry Inspection Summary
        if telem_ctx and telem_ctx.get("connected"):
            telemetry_insight = (
                f"\n\n---"
                f"\n📊 **Live Telemetry Snapshot**:\n"
                f"• **Status**: {'ARMED ⚡' if telem_ctx['armed'] else 'DISARMED 🛑'} | **Mode**: `{telem_ctx['mode']}`\n"
                f"• **Power**: `{telem_ctx['battery_pct']}%` ({telem_ctx['voltage_v']}V)\n"
                f"• **GPS**: `{telem_ctx['gps_fix']}` ({telem_ctx['sats']} Sats, HDOP `{telem_ctx['hdop']}`)\n"
                f"• **Flight Metrics**: Alt `{telem_ctx['rel_alt_m']}m` | Speed `{telem_ctx['groundspeed_ms']} m/s` | Climb `{telem_ctx['climb_ms']} m/s`"
            )
            answer_parts.append(telemetry_insight)
        elif telem_ctx:
            answer_parts.append("\n\n--- \n📡 **Telemetry Link**: Standby (Waiting for drone or simulator connection on UDP 14550 / Serial).")

        full_answer = "\n\n".join(answer_parts)

        return {
            "query": user_query,
            "answer": full_answer,
            "alerts": status_alerts,
            "telemetry_context": telem_ctx,
            "sources": sources,
            "timestamp": time.time()
        }
