# Connector

Python tools for MyoWare 2.0 Wireless Shields. Each shield runs Advancer's BLE peripheral firmware and advertises a name such as `MyoWareSensorL` or `MyoWareSensorR`. Envelope readings are text notifications on characteristic `f3a56edf-8f1e-4533-93bf-5601b2e91308`.

Install the Bluetooth library once:

```bash
python3 -m pip install bleak
```

Turn the shield power switch **ON** before scanning, connecting, or flashing. USB-C is only required for flashing.

## scan_myoware.py

Looks for nearby shields for 10 seconds and prints each `MyoWare` advertisement (name, Bluetooth address, RSSI). Other named devices are listed if no shield is found.

```bash
python3 scan_myoware.py
```

## connect_myoware.py

Connects to the shields named in `NAMES` and prints each envelope sample, prefixed with that shield's name. One entry connects to that shield only. Add a second name to connect to both at once.

```python
NAMES = [
    "MyoWareSensorL",
    "MyoWareSensorR",
]
```

```bash
python3 connect_myoware.py
```

Stop with Ctrl+C. A listed name that is not advertising is skipped. If none of the listed shields are on, the script exits.

## flash_myoware.py

Builds the stock peripheral firmware in `~/Documents/PlatformIO/Projects/MyoWareWireless` and uploads it over USB. The name you pass is compiled in and becomes the name the shield advertises. Requires PlatformIO.

With one shield plugged in:

```bash
python3 flash_myoware.py MyoWareSensorR
```

With more than one shield plugged in, pass the serial port:

```bash
python3 flash_myoware.py MyoWareSensorL --port /dev/cu.usbserial-10
```

After upload it scans to confirm that name is advertising. `--no-scan` skips that check. `--project` points at a different PlatformIO project.
