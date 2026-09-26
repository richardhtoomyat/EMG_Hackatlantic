## scan_myoware.py

Looks for nearby shields for 10 seconds and prints each `MyoWare` advertisement (name, Bluetooth address, RSSI). Other named devices are listed if no shield is found.

```bash
python3 scan_myoware.py
```

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
