"""
FALCONZ AI Copilot — Conversational Aerospace RAG Engine
Self-contained, natural, realistic, telemetry-augmented AI flight assistant.
"""

import math
import re
import time
from typing import List, Dict, Any, Tuple

class RAGEngine:
    """
    Realistic & User-Friendly RAG Engine for FALCONZ GCS.
    Provides conversational, expert flight advice tailored to natural human queries
    and real-time UAV telemetry states.
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
                "keywords": ["guided", "goto", "waypoint", "autonomous", "navigation", "position hold", "fly to", "point"],
                "content": (
                    "GUIDED mode allows you to click anywhere on the map or send target coordinates to command your drone autonomously. "
                    "The flight controller automatically manages pitch, roll, throttle, and heading to navigate directly to the target location. "
                    "It requires a valid 3D GPS fix (HDOP < 2.0) before engaging."
                ),
                "recommendations": "Make sure your GPS 3D Fix is solid and your Home location is correctly marked on the map before sending GUIDED targets."
            },
            {
                "id": "mode_rtl",
                "category": "Flight Modes",
                "title": "RTL (Return To Launch) Mode",
                "keywords": ["rtl", "return to launch", "rth", "failsafe", "home", "land", "emergency", "return home", "come back"],
                "content": (
                    "RTL (Return to Launch / Return to Home) commands your drone to climb to a safe obstacle-clearing height "
                    "(typically 15 to 30 meters), fly straight back to the takeoff spot, loiter briefly, and land automatically. "
                    "It's your safety net and will also trigger automatically if battery drops too low or telemetry signal is lost."
                ),
                "recommendations": "Always double check your Home coordinates on the map before arming!"
            },
            {
                "id": "mode_stabilize",
                "category": "Flight Modes",
                "title": "STABILIZE / Manual Self-Leveling",
                "keywords": ["stabilize", "manual", "self leveling", "roll", "pitch", "throttle", "acro", "level"],
                "content": (
                    "STABILIZE mode gives you manual control over the drone while automatically keeping the roll and pitch level when you release the sticks. "
                    "Keep in mind that throttle is completely manual—the flight controller will not auto-hold altitude for you in this mode."
                ),
                "recommendations": "Keep your thumb active on the throttle stick to maintain hover height."
            },
            {
                "id": "mode_poshold",
                "category": "Flight Modes",
                "title": "POSHOLD / LOITER Mode",
                "keywords": ["poshold", "loiter", "position hold", "hover", "brake", "hold position", "gps hold", "stay"],
                "content": (
                    "POSHOLD (or LOITER) holds your drone's exact 3D position and altitude whenever you center your transmitter sticks. "
                    "It uses GPS, barometer, and optical flow sensors so you can let go of the controls and focus on taking photos or inspecting the area."
                ),
                "recommendations": "If the drone twitches or circles (toilet-bowling) in POSHOLD, perform a quick 3D compass calibration."
            },
            {
                "id": "mode_offboard",
                "category": "Flight Modes",
                "title": "OFFBOARD Companion Mode",
                "keywords": ["offboard", "companion", "ros", "ros2", "sdk", "autonomous", "px4", "pi", "jetson", "computer"],
                "content": (
                    "OFFBOARD mode lets an onboard companion computer (like a Raspberry Pi or NVIDIA Jetson running ROS/ROS2) "
                    "take control of the flight path, streaming position or velocity targets to the flight controller over MAVLink."
                ),
                "recommendations": "Ensure your onboard script is sending continuous heartbeat messages (at least 2 Hz) before switching to OFFBOARD."
            },
            {
                "id": "mode_auto",
                "category": "Flight Modes",
                "title": "AUTO / Mission Mode",
                "keywords": ["auto", "mission", "waypoints", "flight plan", "autonomous", "survey", "route"],
                "content": (
                    "AUTO mode executes pre-stored mission flight plans uploaded to the drone's memory. "
                    "It flies through your waypoints, executes camera triggers, loiters at specified locations, and returns home automatically."
                ),
                "recommendations": "Fetch and review your mission plan in the GCS before flicking the switch to AUTO."
            },

            # Calibration & Hardware
            {
                "id": "cal_accel",
                "category": "Calibration",
                "title": "6-Axis Accelerometer Calibration",
                "keywords": ["accel", "accelerometer", "calibration", "level", "gravity", "imu", "orientation", "trim", "leveling"],
                "content": (
                    "Calibrating the 6-axis accelerometer helps your drone know exactly which way is up. "
                    "You'll place the vehicle stationary in 6 positions: 1. Level, 2. Left Side, 3. Right Side, 4. Nose Down, 5. Nose Up, and 6. Inverted."
                ),
                "recommendations": "Keep the drone completely still during each step until the green confirmation flash appears!"
            },
            {
                "id": "cal_compass",
                "category": "Calibration",
                "title": "3D Compass (Magnetometer) Calibration",
                "keywords": ["compass", "mag", "magnetometer", "sphere", "iron", "heading", "declination", "interference", "toilet bowl", "shaking"],
                "content": (
                    "Compass calibration measures magnetic interference around your frame. "
                    "You rotate the aircraft 360 degrees on all axes until the 3D sampling sphere turns green."
                ),
                "recommendations": "Always do compass calibration outdoors in an open field, away from metal cars, concrete rebar, or laptop batteries!"
            },
            {
                "id": "cal_rc",
                "category": "Calibration",
                "title": "RC Radio Calibration",
                "keywords": ["rc", "radio", "receiver", "pwm", "stick", "transmitter", "channel", "throttle", "yaw", "pitch", "roll", "remote"],
                "content": (
                    "RC calibration teaches the flight controller the full range of your transmitter sticks (min ~1000us, center ~1500us, max ~2000us)."
                ),
                "recommendations": "Center all stick trims on your remote before starting radio calibration."
            },

            # Power & Battery Systems
            {
                "id": "power_battery",
                "category": "Power & Battery",
                "title": "Battery Safety & Voltage Monitoring",
                "keywords": ["battery", "voltage", "current", "lipo", "failsafe", "power", "cell", "mah", "discharge", "charging", "percent", "low battery"],
                "content": (
                    "Keeping an eye on battery voltage prevents unexpected power drops. For a standard 4S LiPo battery: "
                    "Full = 16.8V (4.2V/cell), Nominal = 14.8V (3.7V/cell), Warning = 14.0V (3.5V/cell), and Critical RTL Failsafe = 13.6V (3.4V/cell)."
                ),
                "recommendations": "Plan your landing when the battery indicator reaches 25% or cell voltage approaches 3.5V."
            },

            # GPS & Navigation
            {
                "id": "gps_quality",
                "category": "GPS & Navigation",
                "title": "GPS Fix Types & HDOP Quality",
                "keywords": ["gps", "hdop", "satellites", "sats", "fix", "rtk", "3d fix", "navigation", "location", "accuracy", "signal"],
                "content": (
                    "GPS HDOP measures positioning accuracy. Lower numbers mean higher precision! "
                    "HDOP under 1.5 is excellent, under 2.0 is great for autonomous flight, while HDOP above 2.5 warns of poor satellite geometry."
                ),
                "recommendations": "Wait for at least 8 to 10 satellites and HDOP < 2.0 before arming for autonomous missions."
            },

            # Universal Flight Controller Support
            {
                "id": "fc_compatibility",
                "category": "Flight Controller Architecture",
                "title": "Universal Flight Controller Connection",
                "keywords": ["flight controller", "autopilot", "px4", "ardupilot", "apm", "inav", "betaflight", "mavlink", "telemetry", "connection", "port", "baud", "serial", "udp", "com", "usb"],
                "content": (
                    "FALCONZ connects seamlessly with ArduPilot, PX4, INAV, Betaflight (via MAVLink bridge), and custom robotics controllers. "
                    "You can connect using UDP (127.0.0.1:14550), Serial COM ports, or TCP sockets."
                ),
                "recommendations": "Use 57600 baud for wireless telemetry radios and 115200 or 921600 baud for direct USB connections."
            },

            # Telemetry & Speed
            {
                "id": "telemetry_hud",
                "category": "Telemetry & Speed",
                "title": "Flight Speed & VFR Metrics",
                "keywords": ["speed", "groundspeed", "airspeed", "climb", "throttle", "altitude", "heading", "vfr", "hud", "pfd", "fast", "height"],
                "content": (
                    "Your primary flight display shows real-time Groundspeed (GPS speed), Airspeed (wind speed), Climb Rate (vertical speed in m/s), "
                    "Throttle percentage, and Relative Altitude (height above takeoff)."
                ),
                "recommendations": "Keep your descent rate under 2.5 m/s during manual landing to maintain clean aerodynamic control."
            },

            # Computer Vision & Camera
            {
                "id": "camera_vision",
                "category": "Computer Vision",
                "title": "Live Camera Feed & ORB Feature Tracking",
                "keywords": ["camera", "video", "vision", "orb", "opencv", "feature", "tracking", "stream", "feed", "view"],
                "content": (
                    "FALCONZ includes live video streaming with OpenCV frame processing and ORB feature detection overlays. "
                    "This lets you inspect real-time visual feature tracking points directly in your browser."
                ),
                "recommendations": "Switch to the Camera View tab in the top navigation bar to toggle ORB feature overlays."
            }
        ]

        # Conversational Synonyms
        self.synonyms = {
            "battery": ["battery", "voltage", "power", "lipo", "cell", "current", "mah", "charge", "percent"],
            "speed": ["speed", "groundspeed", "airspeed", "velocity", "fast", "vfr", "climb", "height", "altitude"],
            "gps": ["gps", "hdop", "satellite", "satellites", "sats", "fix", "location", "navigation", "map", "position", "signal"],
            "arm": ["arm", "armed", "arming", "disarm", "pre-arm", "motor", "takeoff", "spin"],
            "mode": ["mode", "guided", "rtl", "stabilize", "auto", "poshold", "loiter", "offboard", "althold"],
            "calibrate": ["calibrate", "calibration", "accel", "compass", "mag", "level", "imu", "radio", "rc"],
            "connect": ["connect", "connection", "port", "baud", "serial", "udp", "com", "usb", "radio"],
            "camera": ["camera", "video", "vision", "orb", "stream", "feed", "opencv"]
        }

    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r'\w+', text.lower())

    def _expand_tokens(self, tokens: List[str]) -> List[str]:
        expanded = set(tokens)
        for token in tokens:
            for key, synonym_list in self.synonyms.items():
                if token in synonym_list or token == key:
                    expanded.update(synonym_list)
        return list(expanded)

    def _score_document(self, query_tokens: List[str], doc: Dict[str, Any]) -> float:
        expanded_tokens = self._expand_tokens(query_tokens)
        doc_keywords = set(doc['keywords'])
        doc_title_tokens = set(self._tokenize(doc['title']))
        doc_text = f"{doc['title']} {doc['category']} {' '.join(doc['keywords'])} {doc['content']}".lower()

        score = 0.0
        for token in query_tokens:
            if len(token) < 2:
                continue
            if token in doc_keywords:
                score += 5.0
            if token in doc_title_tokens:
                score += 4.0
            if token in doc_text:
                score += 1.5

        for token in expanded_tokens:
            if token in doc_keywords:
                score += 1.2

        return score

    def search(self, user_query: str, top_k: int = 2) -> List[Tuple[float, Dict[str, Any]]]:
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
        Executes Realistic, Friendly Conversational RAG Reasoning:
        Synthesizes human-like, encouraging, and clear answers tailored to the pilot's intent.
        """
        q_raw = user_query.strip()
        q_lower = q_raw.lower()
        tokens = self._tokenize(q_lower)
        top_matches = self.search(q_raw, top_k=2)

        # Extract Telemetry State
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

            if telem_ctx["battery_pct"] > 0 and telem_ctx["battery_pct"] <= 25:
                status_alerts.append(f"⚠️ LOW BATTERY: {telem_ctx['battery_pct']}% remaining ({telem_ctx['voltage_v']}V)")
            if telem_ctx["hdop"] > 2.5:
                status_alerts.append(f"⚠️ WEAK GPS: HDOP is {telem_ctx['hdop']} (Recommend < 2.0)")
            if telem_ctx["armed"]:
                status_alerts.append(f"⚡ VEHICLE ARMED in {telem_ctx['mode']} Mode")

        sources = []
        answer_parts = []

        # -------------------------------------------------------------
        # 1. SPECIFIC CONVERSATIONAL INTENTS (Greetings, Status Checks, Thanks)
        # -------------------------------------------------------------
        if any(w in q_lower for w in ["hi", "hello", "hey", "sup", "greetings", "good morning", "good afternoon"]):
            answer_parts.append("Hey there! 👋 I'm your **FALCONZ AI Flight Copilot**.")
            answer_parts.append(
                "I'm keeping a real-time eye on your telemetry stream. Feel free to ask me anything about "
                "flight modes, battery health, pre-arm checks, sensor calibration, or connection setup!"
            )

        elif any(w in q_lower for w in ["status", "how is my drone", "can i fly", "ready to fly", "check drone", "drone status", "is it ready"]):
            answer_parts.append("Here's a quick flight readiness check on your drone right now:")
            if telem_ctx and telem_ctx.get("connected"):
                is_armed = telem_ctx["armed"]
                mode = telem_ctx["mode"]
                bat_pct = telem_ctx["battery_pct"]
                bat_v = telem_ctx["voltage_v"]
                gps_fix = telem_ctx["gps_fix"]
                sats = telem_ctx["sats"]
                hdop = telem_ctx["hdop"]

                answer_parts.append(
                    f"• **Arming Status**: {'⚡ **ARMED**' if is_armed else '🛑 **DISARMED**'} (`{mode}` mode)\n"
                    f"• **Battery**: **{bat_pct}%** ({bat_v}V) — {'✅ Healthy battery levels!' if bat_pct > 30 else '⚠️ Battery is low, recommend charging before takeoff.'}\n"
                    f"• **GPS Positioning**: **{gps_fix}** with **{sats} satellites** (HDOP `{hdop}`) — {'✅ Great satellite lock for autonomous flight!' if hdop < 2.0 and sats >= 6 else '⚠️ Satellite precision is weak, stick to manual hover.'}\n"
                    f"• **Altitude & Speed**: Height **{telem_ctx['rel_alt_m']}m**, Groundspeed **{telem_ctx['groundspeed_ms']} m/s**"
                )

                if not is_armed and bat_pct > 30 and (hdop < 2.0 or gps_fix != "No GPS"):
                    answer_parts.append("👍 **Verdict**: Your drone looks ready for takeoff!")
                elif is_armed:
                    answer_parts.append("🚀 **Verdict**: Vehicle is currently in flight! Monitor battery and flight mode.")
            else:
                answer_parts.append("📡 Telemetry link is currently in **Standby**. Connect your drone via UDP `127.0.0.1:14550` or Serial port to see live health metrics!")

        elif any(w in q_lower for w in ["thanks", "thank you", "awesome", "great", "cool", "perfect", "ok", "nice"]):
            answer_parts.append("You're very welcome! 😊 Fly safe out there! Let me know whenever you need another telemetry check or diagnostic tip.")

        # -------------------------------------------------------------
        # 2. DOCUMENT-MATCHED CONVERSATIONAL ANSWERS
        # -------------------------------------------------------------
        elif top_matches and top_matches[0][0] > 1.8:
            primary_doc = top_matches[0][1]
            sources.append({"id": primary_doc["id"], "title": primary_doc["title"], "category": primary_doc["category"]})

            # Friendly introductory phrasing based on category
            cat = primary_doc["category"]
            title = primary_doc["title"]

            if cat == "Flight Modes":
                answer_parts.append(f"Here's what you need to know about **{title}**:")
            elif cat == "Calibration":
                answer_parts.append(f"Sure thing! Here are the steps for **{title}**:")
            elif cat == "Power & Battery":
                answer_parts.append(f"Here is your battery safety guide for **{title}**:")
            else:
                answer_parts.append(f"Regarding **{title}**:")

            answer_parts.append(primary_doc["content"])
            answer_parts.append(f"💡 **Pro-Tip / Advice**: {primary_doc['recommendations']}")

            # Include secondary reference if strong match
            if len(top_matches) > 1 and top_matches[1][0] > 2.5:
                sec_doc = top_matches[1][1]
                answer_parts.append(f"\nAlso related to your query is **{sec_doc['title']}**:\n{sec_doc['content']}")
                sources.append({"id": sec_doc["id"], "title": sec_doc["title"], "category": sec_doc["category"]})

        # -------------------------------------------------------------
        # 3. HELPFUL GENERAL ASSISTANCE
        # -------------------------------------------------------------
        else:
            answer_parts.append(f"I looked into your question about **\"{q_raw}\"**.")
            answer_parts.append(
                "While I don't have a direct manual parameter matching those exact words, here's how I can help you right now:"
            )
            answer_parts.append(
                "1. **Check Telemetry Cards**: Look at the top overview bar for live battery %, HDOP, and current mode.\n"
                "2. **Calibration Assistance**: Go to the *Calibration* tab for step-by-step guidance on accelerometer, compass, or RC stick setup.\n"
                "3. **Ask me specific questions**: E.g., *\"How to calibrate compass?\"*, *\"What is GUIDED mode?\"*, *\"What is a safe battery voltage?\"*"
            )

        # -------------------------------------------------------------
        # 4. CONVERSATIONAL TELEMETRY SNAPSHOT FOOTER
        # -------------------------------------------------------------
        if telem_ctx and telem_ctx.get("connected") and not any(w in q_lower for w in ["status", "check drone"]):
            mode = telem_ctx["mode"]
            armed_str = "ARMED ⚡" if telem_ctx["armed"] else "DISARMED"
            bat_str = f"{telem_ctx['battery_pct']}% ({telem_ctx['voltage_v']}V)"
            gps_str = f"{telem_ctx['gps_fix']} ({telem_ctx['sats']} Sats)"
            
            answer_parts.append(
                f"\n---\n"
                f"📌 *Live Telemetry*: `{mode}` ({armed_str}) | Battery `{bat_str}` | GPS `{gps_str}`"
            )

        return {
            "query": user_query,
            "answer": "\n\n".join(answer_parts),
            "alerts": status_alerts,
            "telemetry_context": telem_ctx,
            "sources": sources,
            "timestamp": time.time()
        }
