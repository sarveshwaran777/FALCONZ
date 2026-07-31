import time
import math
import argparse
from pymavlink import mavutil

def main():
    parser = argparse.ArgumentParser(description="MAVLink Telemetry Simulator for APM Dashboard")
    parser.add_argument("--target", type=str, default="127.0.0.1:14550", help="Target UDP host:port (default: 127.0.0.1:14550)")
    args = parser.parse_args()

    print(f"Starting MAVLink simulator streaming to udpout:{args.target}...", flush=True)
    mav = mavutil.mavlink_connection(f"udpout:{args.target}", source_system=1, source_component=1)

    t = 0.0
    # Tamil Nadu, India coordinates (Chennai region)
    start_lat = 13.0827
    start_lon = 80.2707

    try:
        while True:
            # 1. HEARTBEAT (1 Hz)
            # MAV_TYPE_QUADROTOR = 2, MAV_AUTOPILOT_ARDUPILOTMEGA = 3
            mav.mav.heartbeat_send(
                type=2,
                autopilot=3,
                base_mode=mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED | mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                custom_mode=4, # GUIDED mode in Copter
                system_status=4
            )

            # 2. ATTITUDE (~10 Hz)
            roll = math.radians(15 * math.sin(t * 0.5))
            pitch = math.radians(8 * math.cos(t * 0.3))
            yaw = math.radians((t * 10) % 360)

            mav.mav.attitude_send(
                time_boot_ms=int(t * 1000) % 0xFFFFFFFF,
                roll=roll,
                pitch=pitch,
                yaw=yaw,
                rollspeed=0.01,
                pitchspeed=0.01,
                yawspeed=0.02
            )

            # 3. GLOBAL_POSITION_INT (~5 Hz)
            # Simulated circular trajectory
            radius = 0.002 # degrees ~ 200m
            lat = start_lat + radius * math.cos(t * 0.1)
            lon = start_lon + radius * math.sin(t * 0.1)
            alt_msl = 150.0 + 10.0 * math.sin(t * 0.2)
            rel_alt = 50.0 + 10.0 * math.sin(t * 0.2)
            heading_cdeg = int(((math.degrees(yaw) + 360) % 360) * 100)

            mav.mav.global_position_int_send(
                time_boot_ms=int(t * 1000) % 0xFFFFFFFF,
                lat=int(lat * 1e7),
                lon=int(lon * 1e7),
                alt=int(alt_msl * 1000),
                relative_alt=int(rel_alt * 1000),
                vx=int(12 * math.cos(t * 0.1) * 100),
                vy=int(12 * math.sin(t * 0.1) * 100),
                vz=int(1 * math.cos(t * 0.2) * 100),
                hdg=heading_cdeg
            )

            # 4. VFR_HUD (~5 Hz)
            mav.mav.vfr_hud_send(
                airspeed=14.5 + 2.0 * math.sin(t * 0.4),
                groundspeed=12.0 + 1.5 * math.cos(t * 0.4),
                heading=int((math.degrees(yaw) + 360) % 360),
                throttle=55 + int(10 * math.sin(t * 0.3)),
                alt=rel_alt,
                climb=1.2 * math.cos(t * 0.2)
            )

            # 5. SYS_STATUS (~2 Hz)
            voltage = max(11000, 15200 - int((t % 1000) * 2)) # mV ~ 15.2V slowly discharging
            current = max(0, 1450 + int(200 * math.sin(t))) # cA ~ 14.5A
            rem_pct = max(10, int(95 - (t % 500) * 0.15))

            mav.mav.sys_status_send(
                onboard_control_sensors_present=0,
                onboard_control_sensors_enabled=0,
                onboard_control_sensors_health=0,
                load=250,
                voltage_battery=voltage,
                current_battery=current,
                battery_remaining=rem_pct,
                drop_rate_comm=0,
                errors_comm=0,
                errors_count1=0,
                errors_count2=0,
                errors_count3=0,
                errors_count4=0
            )

            # 6. GPS_RAW_INT (~2 Hz)
            mav.mav.gps_raw_int_send(
                time_usec=int(t * 1e6) % 0xFFFFFFFF,
                fix_type=3, # 3D Fix
                lat=int(lat * 1e7),
                lon=int(lon * 1e7),
                alt=int(alt_msl * 1000),
                eph=80, # HDOP 0.8
                epv=120,
                vel=1200,
                cog=heading_cdeg,
                satellites_visible=16
            )

            # 7. RC_CHANNELS & SERVO_OUTPUT_RAW
            mav.mav.rc_channels_send(
                int(t * 1000) % 0xFFFFFFFF, # time_boot_ms
                8,            # chancount
                1500 + int(200 * math.sin(t * 0.5)), # chan1
                1500 + int(200 * math.cos(t * 0.3)), # chan2
                1550 + int(300 * math.sin(t * 0.3)), # chan3
                1500 + int(100 * math.sin(t * 0.2)), # chan4
                1800, # chan5
                1200, # chan6
                1500, # chan7
                1000, # chan8
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, # chan9..18
                255   # rssi
            )

            mav.mav.servo_output_raw_send(
                time_usec=int(t * 1e6) % 0xFFFFFFFF,
                port=0,
                servo1_raw=1520 + int(180 * math.sin(t * 0.5)),
                servo2_raw=1480 + int(180 * math.cos(t * 0.3)),
                servo3_raw=1550 + int(250 * math.sin(t * 0.3)),
                servo4_raw=1500,
                servo5_raw=1000,
                servo6_raw=1000,
                servo7_raw=1000,
                servo8_raw=1000
            )

            t += 0.2
            time.sleep(0.2)
    except KeyboardInterrupt:
        print("\nSimulator stopped.")

if __name__ == "__main__":
    main()
