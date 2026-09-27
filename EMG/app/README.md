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
python src/data_access/streamer.py
```

The streamer keeps scanning for configured names, connects when each shield appears, and retries after disconnects.

## Sensor station (`src/station.py`)

This PC plus the MyoWare rig is a **shared station**: anyone can walk up, sign
in on their phone, show a QR code to the webcam, and record into *their own*
account. One user at a time; when they disconnect (or log out, or are idle for
10 minutes) the next person can connect.

```
phone (web app, signed in) ──HTTPS──► Vercel API (/api/me/*) ──► Supabase: stations, connect_codes,
                                           ▲    │                  station_commands, sessions, sets
                     live data (not stored) │    │ commands (long-poll)
                            Redis (15 s) ◄───┘    ▼
                                station.py (/api/station/*) ─► recorder ─► LibEMG ─► MyoWare (BLE)
```

- The station only talks HTTPS to the web app's API, authenticated with its
  own station key. It sends JSON (sets, summaries, live data); Vercel decides
  which account it belongs to (whoever is connected) and does fixed
  inserts/updates. The station never sees a database key or anyone's data.
- **Raw envelope** + live metrics go out 5×/s while a user is connected and
  are plotted on the phone. They pass through Redis (Upstash or Redis Cloud) and expire after
  ~15 s — never saved. Saved: sessions and sets (processed metrics).

### Setup (once per PC)

1. Python **3.12** (the pinned `requirements.txt` is compiled for 3.12 on
   Windows), e.g. `conda create -n myo python=3.12 && conda activate myo`, then:
   - **Windows / Apple-silicon Mac:** `pip install -r requirements.txt`
     (Windows-only Bluetooth packages are skipped on other systems).
   - **Intel Mac, macOS < 14, or anything else that fails:**
     `pip install -r requirements.in "websockets<16" "numba==0.62.1" "llvmlite==0.45.1"`
     (`dearpygui==2.3.1` has no Intel-Mac build, and the newest llvmlite — pulled
     in by LibEMG → librosa → numba — only has Mac builds for macOS 14+ on
     Apple silicon; without the pins pip tries to compile it and fails with
     *"Failed building wheel for llvmlite"*).

   An error like *"Could not find a version that satisfies aiohappyeyeballs==2.7.1
   … Requires-Python >=3.10"* means the active Python is too old. If one package
   fails to build, pip installs nothing — e.g. `No module named 'bleak'` afterwards.
2. Run it once — it registers the station with the web app and saves
   `STATION_ID`, `STATION_NAME` and `STATION_KEY` to `EMG/app/.env`:
   ```bash
   python src/station.py --name "Gym PC 1"
   ```
   To point at another deployment set `STATION_API_URL` in `.env` (default
   `https://emg-hackatlantic.vercel.app`) or pass `--api`. Delete the three
   `STATION_*` lines to register the PC again as a new station.
3. **macOS:** allow the terminal app to use the **Camera** (System Settings →
   Privacy & Security → Camera) and **Bluetooth**, then restart the terminal.

### Every session

```bash
python src/station.py              # real sensors + webcam QR scanner
python src/station.py --simulate   # no hardware: synthetic L/R signal with reps
python src/station.py --no-camera  # no webcam: type the code shown on the phone
```

1. On the phone: sign in → **Workout** → **Show QR code**.
2. Hold it up to the camera window (or type the `XXXXX-XXXXX` code in this
   terminal). The terminal prints *Connected: <name>*, the phone shows the
   station, its sensors and the live signal.
3. On the phone: pick the exercise → **Start recording** → **Next set** →
   **Finish**. Each set is saved as it completes, Finish saves the summary.
   **Cancel** deletes the session.
4. **Disconnect** on the phone, **Logout**, typing `end` here, or 10 minutes
   without activity frees the station. An unfinished workout is discarded.

Terminal commands: a connect code · `end` (disconnect the user) · `quit`.
Codes are single-use and expire after 2 minutes.

### Tuning (`config.yml` → `recording:`)

- `rep_thresholds`: a rep starts above `on_pct` and ends below `off_pct`; time
  above `off_pct` counts as time under tension.
- `calibration`: per-side `rest` / `mvc` in raw envelope units. Without it both
  sides share one adaptive scale (% of the strongest contraction seen so far),
  so the first rep or two of a run are used to find the scale.

### Things to watch when running LibEMG + the MyoWare rig

- **Run one reader at a time.** `data_access/streamer.py`'s own `__main__`, `run.py` and
  `station.py` each start a BLE streamer process. LibEMG lets the second one attach to the
  existing shared-memory buffer ("emg already exists in shared memory"), but
  each MyoWare shield accepts only one BLE connection, so two streamers fight
  over the sensors. Close one before starting the other.
- **Always start from a script**, not a notebook/REPL: LibEMG runs the BLE
  streamer in a separate process (`multiprocessing` "spawn" on Windows/macOS),
  which needs the `if __name__ == "__main__":` / `freeze_support()` guard that
  both scripts have.
- **Buffer order:** LibEMG buffers are newest-first (row 0 = latest), and
  `OnlineDataHandler.get_data(N)` returns the first N rows. `streamer.py`
  previously appended at the bottom, so LibEMG consumers read the *oldest*
  samples; it now matches LibEMG's own streamers.
- **Channel order = `config.yml` order**: channel 0 is `MyoWareSensorL` (left),
  channel 1 `MyoWareSensorR` (right). A missing/stale sensor sends `-1`, which
  the station treats as "no data" (one ring shows 0, imbalance is not computed).
- **Same placement on both sides.** With the shared adaptive scale, a sensor
  placed worse (or with different gain) shows up as imbalance. If the two
  shields read differently at rest or at max, add a per-side `calibration`.
- **Timing:** each shield has its own BLE clock; rows pair the latest fresh
  value from each side (see above), and the station timestamps rows as they are
  read — fine for reps/TUT, not for sample-exact L/R comparisons.
- **Bluetooth permissions:** on macOS allow Bluetooth for your terminal app;
  keep the shields close and charged. The streamer reconnects automatically.
- **Camera:** the QR window must stay on the main thread (macOS). If no
  camera opens, the station says so and you can type codes instead;
  `--camera 1` picks another webcam, `--no-window` scans without a preview.

### Tests

```bash
python -m pytest tests        # signal logic (rep counting, sets, normalisation)
```
