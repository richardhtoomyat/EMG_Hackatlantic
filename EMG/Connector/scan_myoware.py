"""Scan for the MyoWare 2.0 Wireless Shield BLE advertisement."""

import asyncio

from bleak import BleakScanner


async def main():
    print("scanning 10s for MyoWare...", flush=True)
    found = await BleakScanner.discover(timeout=10.0, return_adv=True)

    hits = []
    others = []
    for address, (device, adv) in found.items():
        name = adv.local_name or device.name or ""
        rssi = getattr(adv, "rssi", None)
        if "myoware" in name.lower():
            hits.append((name, address, rssi))
        elif name:
            others.append((name, address, rssi))

    if hits:
        for name, address, rssi in hits:
            print(f"FOUND {name}  {address}  rssi={rssi}")
        return

    print("not seen")
    for name, address, rssi in others:
        print(f"  other: {name}  {address}  rssi={rssi}")


if __name__ == "__main__":
    asyncio.run(main())
