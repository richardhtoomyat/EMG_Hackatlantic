"""Connect to one or more MyoWare 2.0 Wireless Shields and print envelope readings.

Each shield runs Advancer's stock BLE peripheral firmware and notifies one
envelope sample as a text string on each update. List the advertised names to
connect to. One name connects to that shield only.
"""

import asyncio

from bleak import BleakClient, BleakScanner

NAMES = [
    "MyoWareSensorL", "MyoWareSensorR"
]
CHARACTERISTIC_UUID = "f3a56edf-8f1e-4533-93bf-5601b2e91308"


def on_reading(name, _characteristic, data: bytearray):
    text = data.decode("utf-8", errors="replace").strip("\x00").strip()
    if text:
        print(f"{name} {text}", flush=True)


async def stream(device, name):
    print(f"connecting to {name} {device.address}...", flush=True)
    async with BleakClient(device) as client:
        print(f"{name} connected", flush=True)
        await client.start_notify(
            CHARACTERISTIC_UUID,
            lambda characteristic, data: on_reading(name, characteristic, data),
        )
        try:
            while client.is_connected:
                await asyncio.sleep(1)
        finally:
            if client.is_connected:
                await client.stop_notify(CHARACTERISTIC_UUID)


async def main():
    names = [name for name in NAMES if name]
    if not names:
        raise SystemExit("Add at least one shield name to NAMES.")

    print(f"looking for {', '.join(names)}...", flush=True)
    found = await BleakScanner.discover(timeout=10.0, return_adv=True)
    by_name = {}
    for _address, (device, adv) in found.items():
        name = adv.local_name or device.name or ""
        if name in names:
            by_name[name] = device

    for name in names:
        if name not in by_name:
            print(f"{name} not seen", flush=True)
    if not by_name:
        raise SystemExit("No listed shields seen. Turn the shield power switch ON.")

    async with asyncio.TaskGroup() as tasks:
        for name in names:
            device = by_name.get(name)
            if device is not None:
                tasks.create_task(stream(device, name))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
