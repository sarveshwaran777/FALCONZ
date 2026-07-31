import sqlite3
import json
import time
import os
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("TelemetryDB")

class TelemetryDB:
    def __init__(self, db_path: str = "telemetry.db"):
        self.db_path = db_path
        self.init_db()

    def get_connection(self):
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS telemetry_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL NOT NULL,
                    lat REAL,
                    lon REAL,
                    alt REAL,
                    rel_alt REAL,
                    roll REAL,
                    pitch REAL,
                    yaw REAL,
                    heading REAL,
                    groundspeed REAL,
                    airspeed REAL,
                    climb REAL,
                    battery_v REAL,
                    battery_a REAL,
                    battery_pct REAL,
                    flight_mode TEXT,
                    armed INTEGER,
                    raw_json TEXT NOT NULL
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_logs (timestamp)")
            conn.commit()

    def log_telemetry(self, data: Dict[str, Any]):
        if not data.get("connected", False):
            return
        
        ts = data.get("timestamp", time.time())
        position = data.get("position", {})
        attitude = data.get("attitude", {})
        vfr = data.get("vfr_hud", {})
        battery = data.get("battery", {})
        heartbeat = data.get("heartbeat", {})

        lat = position.get("lat")
        lon = position.get("lon")
        alt = position.get("alt")
        rel_alt = position.get("rel_alt")

        roll = attitude.get("roll")
        pitch = attitude.get("pitch")
        yaw = attitude.get("yaw")
        heading = position.get("heading", vfr.get("heading"))

        groundspeed = vfr.get("groundspeed")
        airspeed = vfr.get("airspeed")
        climb = vfr.get("climb")

        battery_v = battery.get("voltage")
        battery_a = battery.get("current")
        battery_pct = battery.get("remaining")

        flight_mode = heartbeat.get("mode")
        armed = 1 if heartbeat.get("armed") else 0

        raw_json = json.dumps(data)

        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO telemetry_logs (
                        timestamp, lat, lon, alt, rel_alt, roll, pitch, yaw, heading,
                        groundspeed, airspeed, climb, battery_v, battery_a, battery_pct,
                        flight_mode, armed, raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    ts, lat, lon, alt, rel_alt, roll, pitch, yaw, heading,
                    groundspeed, airspeed, climb, battery_v, battery_a, battery_pct,
                    flight_mode, armed, raw_json
                ))
                conn.commit()
        except Exception as e:
            logger.error(f"Failed to log telemetry to DB: {e}")

    def get_time_range(self) -> Dict[str, Optional[float]]:
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts, COUNT(*) as count FROM telemetry_logs")
                row = cursor.fetchone()
                if row and row["count"] > 0:
                    return {
                        "min_ts": row["min_ts"],
                        "max_ts": row["max_ts"],
                        "count": row["count"]
                    }
        except Exception as e:
            logger.error(f"Error fetching time range: {e}")
        return {"min_ts": None, "max_ts": None, "count": 0}

    def get_history(self, start_ts: float, end_ts: float, limit: int = 1000) -> List[Dict[str, Any]]:
        results = []
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT raw_json FROM telemetry_logs
                    WHERE timestamp >= ? AND timestamp <= ?
                    ORDER BY timestamp ASC
                    LIMIT ?
                """, (start_ts, end_ts, limit))
                rows = cursor.fetchall()
                for r in rows:
                    results.append(json.loads(r["raw_json"]))
        except Exception as e:
            logger.error(f"Error fetching history: {e}")
        return results
