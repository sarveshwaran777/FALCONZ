"""
FALCONZ AI Copilot — RAG (Retrieval-Augmented Generation) Engine
Self-contained, zero-dependency semantic retrieval and telemetry-augmented reasoning engine.
"""

import math
import re
import time
from typing import List, Dict, Any

class RAGEngine:
    """
    RAG Engine that indexes MAVLink parameter definitions, ArduPilot flight manuals,
    calibration steps, and safety guidelines. Synthesizes knowledge with live drone telemetry.
    """

    def __init__(self):
        self.documents: List[Dict[str, Any]] = []
        self._load_knowledge_base()

    def _load_knowledge_base(self):
        """Populates the knowledge base with curated ArduPilot / PX4 GCS documentation."""
        self.documents = [
            # Flight Modes
            {
                "id": "mode_guided",
                "category": "Flight Modes",
                "title": "GUIDED Mode",
                "keywords": ["guided", "waypoint", "goto", "autonomous", "navigation", "position hold"],
                "content": (
                    "GUIDED mode allows the GCS to dynamically command the vehicle to fly to specific target coordinates "
                    "or follow waypoints. Requires a valid 3D GPS fix (HDOP < 2.0). The flight controller automatically manages "
                    "throttle, roll, and pitch to navigate toward the target location."
                ),
                "recommendations": "Ensure GPS 3D Fix is active before engaging GUIDED mode."
            },
            {
                "id": "mode_rtl",
                "category": "Flight Modes",
                "title": "RTL (Return To Launch) Mode",
                "keywords": ["rtl", "return to launch", "failsafe", "home", "land", "emergency"],
                "content": (
                    "RTL mode commands the aircraft to navigate back to the stored Home location and automatically land. "
                    "Default RTL altitude is typically 15m (1500cm) or higher to clear obstacles. If battery voltage drops "
                    "below critical threshold (FS_BATT_ENABLE), RTL is automatically triggered."
                ),
                "recommendations": "Verify Home position coordinate setting on map prior to takeoff."
            },
            {
                "id": "mode_stabilize",
                "category": "Flight Modes",
                "title": "STABILIZE Mode",
                "keywords": ["stabilize", "manual", "self leveling", "roll", "pitch", "throttle"],
                "content": (
                    "STABILIZE mode provides manual flight control with automatic self-leveling of roll and pitch axes. "
                    "Throttle is controlled manually by the pilot (no automatic altitude hold). Useful for manual control checks."
                ),
                "recommendations": "Pilot must actively control throttle to maintain hover altitude in STABILIZE mode."
            },
            {
                "id": "mode_auto",
                "category": "Flight Modes",
                "title": "AUTO Mode",
                "keywords": ["auto", "mission", "waypoints", "flight plan", "autonomous"],
                "content": (
                    "AUTO mode executes pre-programmed mission waypoints stored in the flight controller EEPROM. "
                    "Supports TAKEOFF, WAYPOINT, LOITER_TURNS, ROI, and RTL commands."
                ),
                "recommendations": "Fetch and verify active mission waypoints in GCS before switching to AUTO."
            },

            # Calibration & Hardware
            {
                "id": "cal_accel",
                "category": "Calibration",
                "title": "6-Axis Accelerometer Calibration",
                "keywords": ["accel", "accelerometer", "calibration", "level", "gravity", "imu", "orientation"],
                "content": (
                    "Accelerometer calibration requires placing the vehicle sequentially in 6 distinct stationary positions: "
                    "1. Level (Nose Flat), 2. Left Side, 3. Right Side, 4. Nose Down, 5. Nose Up, and 6. Inverted (Back). "
                    "Calculates IMU offset & scaling vectors stored in INS_ACCOFFS parameters."
                ),
                "recommendations": "Ensure flight controller remains perfectly motionless while capturing each orientation."
            },
            {
                "id": "cal_compass",
                "category": "Calibration",
                "title": "3D Compass (Magnetometer) Calibration",
                "keywords": ["compass", "mag", "magnetometer", "sphere", "iron", "heading", "declination"],
                "content": (
                    "Compass calibration measures hard-iron and soft-iron magnetic interference around the aircraft. "
                    "Rotate the aircraft through 360 degrees on all axes until the 3D sampling sphere turns green. "
                    "Calculates COMPASS_OFS_X, COMPASS_OFS_Y, and COMPASS_OFS_Z offsets."
                ),
                "recommendations": "Perform compass calibration outdoors away from metal structures, high-voltage lines, and laptop batteries."
            },
            {
                "id": "cal_frame",
                "category": "Calibration",
                "title": "Frame Type & Motor Matrix Selection",
                "keywords": ["frame", "quad", "hex", "octo", "motor", "matrix", "propeller", "rotation"],
                "content": (
                    "Configures vehicle frame class (FRAME_CLASS: Quad=1, Hexa=2, Octo=3) and frame alignment type "
                    "(FRAME_TYPE: Plus=0, X=1, V=2). Flashes motor CW/CCW rotation maps to APM EEPROM."
                ),
                "recommendations": "Verify propeller rotation direction matches the active frame matrix diagram before arming."
            },

            # Battery & Power Systems
            {
                "id": "power_battery",
                "category": "Power & Battery",
                "title": "Battery Voltage & Failsafe Parameters",
                "keywords": ["battery", "voltage", "current", "lipo", "failsafe", "power", "cell"],
                "content": (
                    "Monitors main propulsion battery voltage and current consumption. "
                    "For a 4S LiPo battery: Full = 16.8V (4.2V/cell), Nominal = 14.8V (3.7V/cell), Low Alarm = 14.0V (3.5V/cell), "
                    "Critical Failsafe = 13.6V (3.4V/cell). Below critical threshold, Failsafe triggers RTL or LAND."
                ),
                "recommendations": "Do not attempt takeoff if total remaining battery capacity is below 30%."
            },

            # GPS & Navigation
            {
                "id": "gps_quality",
                "category": "GPS & Navigation",
                "title": "GPS Fix Types & HDOP Quality Metrics",
                "keywords": ["gps", "hdop", "satellites", "fix", "rtk", "3d fix", "navigation"],
                "content": (
                    "GPS Fix status defines positioning accuracy: 0-1 = No Fix, 2 = 2D Fix, 3 = 3D Fix, 4 = DGPS, 5 = RTK Float, 6 = RTK Fixed. "
                    "HDOP (Horizontal Dilution of Precision) measures geometric accuracy: HDOP < 1.5 is Excellent, < 2.0 is Good for GUIDED/AUTO, "
                    "> 2.5 warns of poor satellite geometry."
                ),
                "recommendations": "Require minimum 8 visible satellites and HDOP < 2.0 for safe autonomous flight."
            },

            # Safety & Arming
            {
                "id": "arming_checks",
                "category": "Safety & Arming",
                "title": "Universal Pre-Arming Safety Checks",
                "keywords": ["arm", "disarm", "arming", "pre-arm", "check", "safety", "switch", "px4", "ardupilot", "inav"],
                "content": (
                    "Pre-arm checks verify flight controller readiness across ArduPilot, PX4, and INAV before spinning motors. Checks include: "
                    "1. IMU & Gyro calibration status, 2. Compass health & offsets, 3. Barometer pressure stability, "
                    "4. GPS 3D Fix & HDOP, 5. RC Receiver connection, 6. Battery voltage levels."
                ),
                "recommendations": "Never disable pre-arm safety checks unless performing indoor bench testing without propellers."
            },

            # Universal Flight Controller Support
            {
                "id": "fc_compatibility",
                "category": "Flight Controller Architecture",
                "title": "Universal Autopilot & Telemetry Support",
                "keywords": ["flight controller", "autopilot", "px4", "ardupilot", "apm", "inav", "betaflight", "mavlink", "telemetry"],
                "content": (
                    "FALCONZ supports all major open-source and enterprise flight controllers via MAVLink v1.0 and v2.0 protocols. "
                    "Compatible autopilots include ArduPilot (Copter, Plane, Rover, Sub), PX4 Autopilot (Multicopter, VTOL, Fixed-Wing), "
                    "INAV (via MAVLink telemetry stream), and custom embedded robotics controllers."
                ),
                "recommendations": "Select the appropriate baud rate (typically 57600 for RF telemetry radios, 115200 for direct USB) when connecting."
            }
        ]

    def _tokenize(self, text: str) -> List[str]:
        """Cleans and tokenizes text into lowercase words."""
        return re.findall(r'\w+', text.lower())

    def _score_document(self, query_tokens: List[str], doc: Dict[str, Any]) -> float:
        """Computes keyword overlap score for a document."""
        doc_text = f"{doc['title']} {doc['category']} {' '.join(doc['keywords'])} {doc['content']}".lower()
        score = 0.0
        for token in query_tokens:
            if len(token) < 2:
                continue
            if token in doc['keywords']:
                score += 3.5
            if token in doc['title'].lower():
                score += 3.0
            if token in doc_text:
                score += 1.0
        return score

    def search(self, user_query: str, top_k: int = 2) -> List[Dict[str, Any]]:
        """Retrieves top_k most relevant knowledge base documents."""
        tokens = self._tokenize(user_query)
        if not tokens:
            return self.documents[:top_k]

        scored_docs = []
        for doc in self.documents:
            score = self._score_document(tokens, doc)
            if score > 0:
                scored_docs.append((score, doc))

        scored_docs.sort(key=lambda x: x[0], reverse=True)
        results = [doc for _, doc in scored_docs[:top_k]]
        
        # Fallback to top documents if no exact keyword match
        if not results:
            results = self.documents[:top_k]
        return results

    def query(self, user_query: str, telemetry_state: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Executes Retrieval-Augmented Generation:
        1. Retrieves relevant documents from knowledge base
        2. Fuses live MAVLink telemetry context (battery, GPS, flight mode, armed status)
        3. Synthesizes a structured answer with recommendations & citations
        """
        retrieved_docs = self.search(user_query, top_k=2)
        
        # Format live telemetry snapshot summary
        telem_ctx = {}
        status_alerts = []

        if telemetry_state:
            hb = telemetry_state.get("heartbeat", {})
            pos = telemetry_state.get("position", {})
            bat = telemetry_state.get("battery", {})
            gps = telemetry_state.get("gps", {})
            vfr = telemetry_state.get("vfr_hud", {})

            telem_ctx = {
                "armed": hb.get("armed", False),
                "mode": hb.get("mode", "STANDBY"),
                "altitude_m": round(pos.get("alt", 0.0) or 0.0, 1),
                "voltage_v": round(bat.get("voltage", 0.0) or 0.0, 2),
                "battery_pct": bat.get("remaining", 0) or 0,
                "gps_fix": gps.get("fix_type", "No GPS"),
                "sats": gps.get("satellites_visible", 0) or 0,
                "hdop": round(gps.get("hdop", 0.0) or 0.0, 2),
                "groundspeed_ms": round(vfr.get("groundspeed", 0.0) or 0.0, 1)
            }

            # Generate real-time telemetry alerts
            if telem_ctx["battery_pct"] > 0 and telem_ctx["battery_pct"] <= 25:
                status_alerts.append(f"⚠️ LOW BATTERY WARNING: {telem_ctx['battery_pct']}% remaining ({telem_ctx['voltage_v']}V)")
            if telem_ctx["hdop"] > 2.5:
                status_alerts.append(f"⚠️ POOR GPS QUALITY: HDOP is {telem_ctx['hdop']} (Recommend < 2.0)")
            if telem_ctx["armed"]:
                status_alerts.append(f"⚡ VEHICLE IS ARMED ({telem_ctx['mode']} Mode)")

        # Synthesize Context-Aware Answer
        doc_summaries = []
        sources = []

        for d in retrieved_docs:
            doc_summaries.append(f"**{d['title']}** ({d['category']}): {d['content']}")
            sources.append({
                "id": d["id"],
                "title": d["title"],
                "category": d["category"]
            })

        answer_intro = f"Based on FALCONZ Aerospace Knowledge Base and live telemetry inspection:"
        retrieved_text = "\n\n".join(doc_summaries)
        
        telemetry_insight = ""
        if telem_ctx:
            telemetry_insight = (
                f"\n\n**Live Telemetry Status**: Vehicle is currently **{telem_ctx['mode']}** "
                f"({ 'ARMED ⚡' if telem_ctx['armed'] else 'DISARMED' }), Battery at **{telem_ctx['battery_pct']}%** "
                f"({telem_ctx['voltage_v']}V), GPS **{telem_ctx['gps_fix']}** ({telem_ctx['sats']} Sats, HDOP {telem_ctx['hdop']})."
            )

        full_answer = f"{answer_intro}\n\n{retrieved_text}{telemetry_insight}"

        return {
            "query": user_query,
            "answer": full_answer,
            "alerts": status_alerts,
            "telemetry_context": telem_ctx,
            "sources": sources,
            "timestamp": time.time()
        }
