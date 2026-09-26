"""Flash a MyoWare 2.0 Wireless Shield with the stock BLE peripheral firmware.

The advertised name is compiled into the firmware. Pass the name to give that
shield, for example MyoWareSensorR. Only the serial port you select is flashed.
"""

import argparse
import asyncio
import os
from pathlib import Path
import subprocess
import sys

from bleak import BleakScanner

DEFAULT_PROJECT = Path("/Users/richard/Documents/PlatformIO/Projects/MyoWareWireless")
PIO = Path.home() / ".platformio/penv/bin/pio"


def serial_ports():
    return sorted(Path("/dev").glob("cu.usbserial*"))


def flash(name, port, project):
    if not PIO.is_file():
        raise SystemExit(f"PlatformIO not found at {PIO}")
    if not project.is_dir():
        raise SystemExit(f"Firmware project not found at {project}")
    if not name:
        raise SystemExit("A shield name is required.")

    env = os.environ.copy()
    env["MYOWARE_LOCAL_NAME"] = name
    command = [
        str(PIO),
        "run",
        "-t",
        "upload",
        "-d",
        str(project),
        "--upload-port",
        str(port),
    ]
    print(f"flashing {name} to {port}", flush=True)
    subprocess.run(command, check=True, env=env)


async def confirm(name):
    print(f"scanning 10s for {name}...", flush=True)
    found = await BleakScanner.discover(timeout=10.0, return_adv=True)
    for address, (device, adv) in found.items():
        seen = adv.local_name or device.name or ""
        if seen == name:
            rssi = getattr(adv, "rssi", None)
            print(f"FOUND {seen}  {address}  rssi={rssi}", flush=True)
            return
    raise SystemExit(f"{name} not seen after flashing. Turn the shield power switch ON.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", help="BLE name to advertise, such as MyoWareSensorR")
    parser.add_argument("--port", help="Serial port. Required when more than one shield is plugged in.")
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    parser.add_argument("--no-scan", action="store_true", help="Skip the Bluetooth check after upload.")
    args = parser.parse_args()

    ports = serial_ports()
    if args.port:
        port = Path(args.port)
    elif len(ports) == 1:
        port = ports[0]
    elif not ports:
        raise SystemExit("No /dev/cu.usbserial device found.")
    else:
        listed = ", ".join(str(item) for item in ports)
        raise SystemExit(f"More than one shield is connected ({listed}). Pass --port.")

    flash(args.name, port, args.project)
    if not args.no_scan:
        asyncio.run(confirm(args.name))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
