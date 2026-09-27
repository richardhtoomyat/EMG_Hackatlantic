"""activateMyo bridge: connects the MyoWare rig on this laptop to the web app.

    python src/bridge.py              # real sensors (streamer.py + LibEMG)
    python src/bridge.py --simulate   # synthetic signal, no hardware needed

How it talks to the web app (Supabase Realtime Broadcast, no database access):
  * On first run it creates a pairing code (saved in .pairing_code). Enter it
    once on the web app's Workout screen; both sides then share the channel
    "myo:<code>".
  * Web app → bridge: start_session, next_set, finish_session, cancel_session,
    resend_summary.
  * Bridge → web app: status (heartbeat every 2 s), session_started, live
    (5×/s, batched samples), set_complete, session_complete (the summary the
    browser saves to Supabase as the signed-in user), error.
It also serves http://localhost:5000 with a live chart at the full sample rate
for checking the signal locally.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Optional

from recorder import PairNormalizer, RepThresholds, SessionRecorder
from sources import LibEMGSource, SampleSource, SimulatedSource

APP_DIR = Path(__file__).resolve().parents[1]
PAIRING_FILE = APP_DIR / ".pairing_code"
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L

LOOP_HZ = 20  # read + process rate
LIVE_HZ = 5  # broadcast rate (batched); keeps well inside the free plan's 100 msg/s
STATUS_EVERY_S = 2.0
SENSOR_STALE_S = 2.0


def load_env() -> tuple[str, str]:
    """SUPABASE_URL / SUPABASE_ANON_KEY from the environment or app/.env."""
    env_file = APP_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_ANON_KEY", "")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_ANON_KEY in EMG/app/.env (see .env.example).")
    return url.rstrip("/"), key


def pairing_code() -> str:
    if PAIRING_FILE.exists():
        code = PAIRING_FILE.read_text(encoding="utf-8").strip().upper()
        if len(code) == 8 and all(c in CODE_ALPHABET for c in code):
            return code
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    PAIRING_FILE.write_text(code, encoding="utf-8")
    return code


def pretty(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


class Bridge:
    def __init__(self, source: SampleSource, code: str, thresholds: RepThresholds,
                 calibration: Optional[list[dict]] = None) -> None:
        self.source = source
        self.code = code
        self.thresholds = thresholds
        self.norm = PairNormalizer(calibration)
        self.session: Optional[SessionRecorder] = None
        self.last_summary: Optional[dict] = None
        self.channel: Any = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.last_seen = [0.0, 0.0]  # per side, monotonic
        self.connected = False
        # Local chart feed (Flask thread reads, asyncio loop writes).
        self.lock = threading.Lock()
        self.local: deque[tuple[int, float, Optional[float], Optional[float]]] = deque(maxlen=2000)
        self.local_seq = 0
        self._batch: list[list[Optional[float]]] = []

    # ---------------------------------------------------------------- realtime
    async def send(self, event: str, payload: dict) -> None:
        if self.channel is None:
            return
        try:
            await self.channel.send_broadcast(event, payload)
        except Exception as exc:  # disconnected: the next heartbeat retries
            print(f"[Realtime] send {event} failed: {exc}", flush=True)

    def _handler(self, fn):
        def callback(message: dict) -> None:
            payload = message.get("payload") or {}
            if self.loop is not None:
                self.loop.call_soon_threadsafe(lambda: asyncio.ensure_future(fn(payload)))
        return callback

    async def on_start(self, p: dict) -> None:
        sid = str(p.get("session_id") or "")
        if not sid:
            return
        if self.session is not None:
            if self.session.session_id == sid:  # retry from the browser: re-acknowledge
                await self.send("session_started", {"session_id": sid})
                return
            await self.send("error", {"session_id": sid, "message": "Already recording another session."})
            return
        now = time.monotonic()
        self.session = SessionRecorder(
            session_id=sid,
            exercise_name=str(p.get("exercise_name") or "Workout"),
            left_label=str(p.get("left_label") or "Left"),
            right_label=str(p.get("right_label") or "Right"),
            started_at=now,
            thresholds=self.thresholds,
        )
        self._wall_offset = time.time() - now
        print(f"[Session] started {self.session.exercise_name} ({sid})", flush=True)
        await self.send("session_started", {"session_id": sid})

    async def on_next_set(self, p: dict) -> None:
        s = self.session
        if s is None or p.get("session_id") != s.session_id:
            return
        done = s.next_set(time.monotonic())
        print(f"[Session] set {done.set_number}: {done.reps} reps, {round(done.tut_s)} s TUT", flush=True)
        # Full set data so the browser can save the row right away; rest time is
        # only known once the next set starts, so it is filled in by the summary.
        await self.send("set_complete", {"session_id": s.session_id, "kept": done.kept,
                                         "set": done.to_payload()})

    async def on_finish(self, p: dict) -> None:
        s = self.session
        sid = p.get("session_id")
        if s is None or sid != s.session_id:
            # Already finished: the browser may have missed the summary.
            if self.last_summary and self.last_summary["session_id"] == sid:
                await self.send("session_complete", self.last_summary)
            return
        summary = s.finish(time.monotonic())
        # Monotonic → wall-clock ISO timestamps for the database.
        for k in ("started_at", "ended_at"):
            summary[k] = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(summary[k] + self._wall_offset)) + "Z"
        self.last_summary, self.session = summary, None
        print(f"[Session] finished: {len(summary['sets'])} sets, score {summary['activation_score']}", flush=True)
        await self.send("session_complete", summary)

    async def on_resend(self, p: dict) -> None:
        if self.last_summary and self.last_summary["session_id"] == p.get("session_id"):
            await self.send("session_complete", self.last_summary)

    async def on_cancel(self, p: dict) -> None:
        if self.session is not None and p.get("session_id") == self.session.session_id:
            print("[Session] cancelled", flush=True)
            self.session = None

    def status(self) -> dict:
        now = time.monotonic()
        s = self.session
        return {
            "state": "recording" if s else "idle",
            "session_id": s.session_id if s else None,
            "set_number": s.current.set_number if s else None,
            "sensors": {"left": now - self.last_seen[0] < SENSOR_STALE_S,
                        "right": now - self.last_seen[1] < SENSOR_STALE_S},
        }

    async def realtime_forever(self, url: str, key: str) -> None:
        from realtime import AsyncRealtimeClient

        while True:
            client = AsyncRealtimeClient(f"{url}/realtime/v1", key, max_retries=10, initial_backoff=1.0)
            channel = client.channel(f"myo:{self.code}")
            channel.on_broadcast("start_session", self._handler(self.on_start))
            channel.on_broadcast("next_set", self._handler(self.on_next_set))
            channel.on_broadcast("finish_session", self._handler(self.on_finish))
            channel.on_broadcast("resend_summary", self._handler(self.on_resend))
            channel.on_broadcast("cancel_session", self._handler(self.on_cancel))
            try:
                await channel.subscribe()
                self.channel, self.connected = channel, True
                print(f"[Realtime] connected; channel myo:{self.code}", flush=True)
                while client.is_connected:
                    await asyncio.sleep(1)
            except Exception as exc:
                print(f"[Realtime] connection problem: {exc}", flush=True)
            finally:
                self.channel, self.connected = None, False
                try:
                    await client.close()
                except Exception:
                    pass
            print("[Realtime] reconnecting in 3 s…", flush=True)
            await asyncio.sleep(3)

    # ---------------------------------------------------------------- sampling
    async def sample_forever(self) -> None:
        last_live = last_status = 0.0
        while True:
            for t, left_raw, right_raw in self.source.read():
                left, right = self.norm.update(left_raw, right_raw)
                if left is not None:
                    self.last_seen[0] = t
                if right is not None:
                    self.last_seen[1] = t
                if self.session is not None:
                    self.session.feed(t, left, right)
                    self._batch.append([round(t - self.session.started_at, 2),
                                        None if left is None else round(left),
                                        None if right is None else round(right)])
                with self.lock:
                    self.local_seq += 1
                    self.local.append((self.local_seq, t, left, right))

            now = time.monotonic()
            if self.session is not None and now - last_live >= 1.0 / LIVE_HZ:
                last_live = now
                batch, self._batch = self._batch, []
                await self.send("live", {"session_id": self.session.session_id, **self.session.live(),
                                         "samples": batch})
            if now - last_status >= STATUS_EVERY_S:
                last_status = now
                await self.send("status", self.status())
            await asyncio.sleep(1.0 / LOOP_HZ)

    async def run(self, url: str, key: str) -> None:
        self.loop = asyncio.get_running_loop()
        await asyncio.gather(self.realtime_forever(url, key), self.sample_forever())


# -------------------------------------------------------------------- flask
PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>activateMyo bridge</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;background:#0b0e15;color:#eceae4;font:15px system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px}h1{font-weight:400;margin:0 0 4px}
.code{font:600 34px ui-monospace,monospace;letter-spacing:4px;color:#7fb8c9}
.row{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.pill{background:#1a1e2a;border-radius:999px;padding:6px 12px}
.ok{color:#7fb8c9}.bad{color:#e07a5f}canvas{background:#11151e;border-radius:14px;padding:8px}</style></head>
<body><main><h1>activateMyo bridge</h1><div>Pairing code — enter it on the web app's Workout screen:</div>
<div class="code">__CODE__</div>
<div class="row" id="status"></div><canvas id="chart" height="110"></canvas></main>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script>
const chart = new Chart(document.getElementById("chart"), {type: "line",
  data: {labels: [], datasets: [{label: "Left %", data: [], borderColor: "#D9B26A", pointRadius: 0},
                                {label: "Right %", data: [], borderColor: "#7FB8C9", pointRadius: 0}]},
  options: {animation: false, scales: {y: {min: 0, max: 100}, x: {display: false}}}});
let since = 0;
async function tick() {
  try {
    const r = await (await fetch("/api/samples?since=" + since)).json();
    for (const [seq, l, rr] of r.samples) { since = seq;
      chart.data.labels.push(seq); chart.data.datasets[0].data.push(l); chart.data.datasets[1].data.push(rr); }
    while (chart.data.labels.length > 400) { chart.data.labels.shift(); chart.data.datasets.forEach(d => d.data.shift()); }
    chart.update("none");
    const s = r.status, pill = (ok, t) => `<span class="pill ${ok ? "ok" : "bad"}">${t}</span>`;
    document.getElementById("status").innerHTML =
      pill(r.connected, r.connected ? "Supabase connected" : "Supabase offline") +
      pill(s.sensors.left, "Left sensor") + pill(s.sensors.right, "Right sensor") +
      pill(s.state === "recording", s.state === "recording" ? "● Recording set " + s.set_number : "Idle");
  } catch (e) {}
  setTimeout(tick, 100);
}
tick();
</script></body></html>"""


def start_flask(bridge: Bridge, port: int) -> None:
    from flask import Flask, jsonify, request

    app = Flask("activatemyo-bridge")

    @app.get("/")
    def index():  # type: ignore[no-untyped-def]
        return PAGE.replace("__CODE__", pretty(bridge.code))

    @app.get("/api/samples")
    def samples():  # type: ignore[no-untyped-def]
        since = int(request.args.get("since", 0))
        with bridge.lock:
            rows = [(seq, None if l is None else round(l, 1), None if r is None else round(r, 1))
                    for seq, _t, l, r in bridge.local if seq > since]
        return jsonify(samples=rows[-400:], status=bridge.status(), connected=bridge.connected)

    threading.Thread(target=lambda: app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False),
                     daemon=True, name="flask").start()


def load_tuning() -> tuple[RepThresholds, Optional[list[dict]]]:
    """Optional `recording:` section of config.yml (rep thresholds, calibration)."""
    import yaml

    raw = yaml.safe_load((APP_DIR / "config.yml").read_text(encoding="utf-8")) or {}
    rec = raw.get("recording") or {}
    th = RepThresholds(**{k: float(v) for k, v in (rec.get("rep_thresholds") or {}).items()})
    cal = rec.get("calibration")
    calibration = [cal.get("left") or {}, cal.get("right") or {}] if isinstance(cal, dict) else None
    return th, calibration


async def check_realtime(url: str, key: str, code: str) -> bool:
    """Round-trip test: two clients on the pairing channel, one pings the other."""
    from realtime import AsyncRealtimeClient

    got = asyncio.Event()
    a = AsyncRealtimeClient(f"{url}/realtime/v1", key, max_retries=2)
    b = AsyncRealtimeClient(f"{url}/realtime/v1", key, max_retries=2)
    ca, cb = a.channel(f"myo:{code}"), b.channel(f"myo:{code}")
    cb.on_broadcast("check", lambda m: got.set())
    try:
        await ca.subscribe()
        await cb.subscribe()
        await asyncio.sleep(1)
        await ca.send_broadcast("check", {"t": time.time()})
        await asyncio.wait_for(got.wait(), timeout=5)
        return True
    except Exception as exc:
        print(f"[check] failed: {exc!r}", flush=True)
        return False
    finally:
        for c in (a, b):
            try:
                await c.close()
            except Exception:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--simulate", action="store_true", help="use a synthetic signal instead of the sensors")
    parser.add_argument("--port", type=int, default=5000, help="local Flask page port (0 = off)")
    parser.add_argument("--new-code", action="store_true", help="generate a new pairing code")
    parser.add_argument("--check", action="store_true", help="test the Supabase Realtime connection and exit")
    args = parser.parse_args()

    url, key = load_env()
    if args.new_code and PAIRING_FILE.exists():
        PAIRING_FILE.unlink()
    code = pairing_code()
    if args.check:
        ok = asyncio.run(check_realtime(url, key, code))
        print("Realtime OK: messages go through Supabase." if ok else
              "Realtime FAILED: check SUPABASE_URL / SUPABASE_ANON_KEY, the network, and that Realtime is enabled.")
        raise SystemExit(0 if ok else 1)
    thresholds, calibration = load_tuning()
    source: SampleSource = SimulatedSource() if args.simulate else LibEMGSource()
    bridge = Bridge(source, code, thresholds, calibration)

    print(f"\n  Pairing code:  {pretty(code)}   (enter it on the Workout screen)\n", flush=True)
    if args.port:
        start_flask(bridge, args.port)
        print(f"  Local live chart: http://localhost:{args.port}\n", flush=True)
    try:
        asyncio.run(bridge.run(url, key))
    except KeyboardInterrupt:
        print("\nBye.", flush=True)


if __name__ == "__main__":
    import multiprocessing as mp

    mp.freeze_support()  # the real-sensor path starts a streamer subprocess
    main()
