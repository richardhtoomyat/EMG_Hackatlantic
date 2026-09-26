# MyoWare BLE streamer

The app reads envelope notifications from the stock MyoWare 2.0 Wireless Shield BLE firmware and places them in a LibEMG shared-memory buffer. It connects by the advertised BLE names, so no serial receiver is required.

## Configure sensors

Edit `config.yml` and list the shields in the desired LibEMG channel order:

```yaml
ble:
  sensor_names:
    - MyoWareSensorL
    - MyoWareSensorR
  characteristic_uuid: "f3a56edf-8f1e-4533-93bf-5601b2e91308"
  missing_value: -1
  channel_stale_after_ms: 100
  reconnect_delay_s: 2
```

The current config lists only `MyoWareSensorL`. Add `MyoWareSensorR` when that shield is ready, then restart the app; the LibEMG buffer will then have two columns. Until the second sensor connects or produces a recent reading, its column is `-1`. Use `get_online_handler(channel_mask=[0])` while only one sensor is available.

The first configured sensor is the output row clock. Each of its notifications appends a row containing its latest value and the latest still-fresh value from other sensors. The stock notification payload is parsed as a number. Since each shield has its own BLE connection and clock, this pairs the most recent readings; it does not guarantee sample-exact synchronization between sensors.

## Install and run

Install the dependencies from `requirements.txt` (or use `pip-sync requirements.txt` with pip-tools), power on the configured shields, and run:

```powershell
python src/streamer.py
```

The streamer keeps scanning for configured names, connects when each shield appears, and retries after disconnects.
