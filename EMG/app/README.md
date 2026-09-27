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

## Recording into the web app (`src/bridge.py`)

`bridge.py` connects this laptop's sensors to the activateMyo web app. It reads
the LibEMG buffer that `streamer.py` fills, turns the left/right envelope into
% activation, reps, time under tension and sets, and talks to the web app over
**Supabase Realtime** — so it works with the deployed site, from any device.
It never writes to the database itself: the signed-in browser saves the data.

```
Workout screen ──start / next set / finish──►  Supabase Realtime  ──►  bridge.py ─► LibEMG ─► MyoWare (BLE)
      ▲  saves sessions/sets rows                "myo:<code>"             │
      └────────── live (5/s), set_complete, session_complete ◄────────────┘
```

### Setup (once)

1. Python **3.12** (the pinned `requirements.txt` is compiled for 3.12), then
   `pip install -r requirements.txt`.
2. `cp .env.example .env` and fill in `SUPABASE_URL` / `SUPABASE_ANON_KEY` — the
   same values as the web app's `VITE_SUPABASE_*`. Never the `service_role` key.
3. `python src/bridge.py --check` — confirms messages go through Supabase Realtime.
4. In Supabase, `Webapp/supabase/write_access.sql` must have been run (the
   browser saves sessions and sets as the signed-in user).

### Every session

```bash
python src/bridge.py              # real sensors
python src/bridge.py --simulate   # no hardware: synthetic L/R signal with reps
```

- It prints a **pairing code** (kept in `.pairing_code`). Enter it once on the
  web app's **Workout** screen; the screen then shows *Laptop online* and which
  sensors are live. `--new-code` makes a new code (you'll need to re-pair).
- **Start recording** creates the `sessions` row immediately and shows its
  **session ID** plus ready-to-run SQL. **Next set** saves that set's row;
  **Finish** writes the score/end time and final set data; **Cancel** deletes it.
- `http://localhost:5000` shows a live chart of both channels at the full
  sample rate — the quickest way to see if the signal is clean. `--port 0`
  turns it off, `--port 5055` moves it (on macOS, port 5000 is often taken by
  AirPlay Receiver).

### Tuning (`config.yml` → `recording:`)

- `rep_thresholds`: a rep starts above `on_pct` and ends below `off_pct`; time
  above `off_pct` counts as time under tension.
- `calibration`: per-side `rest` / `mvc` in raw envelope units. Without it both
  sides share one adaptive scale (% of the strongest contraction seen so far),
  so the first rep or two of a run are used to find the scale.

### Things to watch when running LibEMG + the MyoWare rig

- **Run one reader at a time.** `streamer.py`'s own `__main__` and `bridge.py`
  each start a BLE streamer process. LibEMG lets the second one attach to the
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
  the bridge treats as "no data" (one ring shows 0, imbalance is not computed).
- **Same placement on both sides.** With the shared adaptive scale, a sensor
  placed worse (or with different gain) shows up as imbalance. If the two
  shields read differently at rest or at max, add a per-side `calibration`.
- **Timing:** each shield has its own BLE clock; rows pair the latest fresh
  value from each side (see above), and the bridge timestamps rows as they are
  read — fine for reps/TUT, not for sample-exact L/R comparisons.
- **Bluetooth permissions:** on macOS allow Bluetooth for your terminal app;
  keep the shields close and charged. The streamer reconnects automatically.
- **Supabase free plan:** Realtime allows 100 messages/s per project and 2 M
  per month. The bridge sends 5 batched `live` messages/s per recording (plus
  a status every 2 s), so several people can record at once.
- **Security:** channels are public — anyone with the (public) anon key and
  the pairing code could listen or send commands. Keep the code private; use
  `--new-code` if it leaks. Private channels would need Realtime Authorization.

### Tests

```bash
python -m pytest tests        # signal logic (rep counting, sets, normalisation)
```
