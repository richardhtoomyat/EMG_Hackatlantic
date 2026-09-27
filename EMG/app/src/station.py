"""activateMyo station: this PC + the MyoWare sensors, shared by one user at a time.

    python src/station.py                 # real sensors, webcam QR scan
    python src/station.py --simulate      # synthetic signal, no hardware needed
    python src/station.py --no-camera     # type the code shown on the phone instead

First run registers the station with the web app and saves STATION_ID /
STATION_KEY to EMG/app/.env (anyone can run a station; the key only lets this
PC act as *this station*, never read anyone's data).

How it works (plain HTTPS to the Vercel API, nothing else):
  1. The station is "available". A user signs in on their phone, opens
     Workout → Connect, and holds the QR code up to this PC's webcam (or types
     the code here). The station sends the code to /api/station/claim and is
     now connected to that user.
  2. The phone's buttons (Start / Next set / Finish / Cancel) are delivered to
     the station through /api/station/commands (long-poll).
  3. While a user is connected, the station posts live data 5×/s to
     /api/station/live (raw envelope + live metrics; shown on the phone, never
     stored). Completed sets and the final summary go to /api/station/set and
     /api/station/finish; Vercel saves them to the connected user's account.
  4. The user disconnects on the phone (or logs out), types `end` here, or is
     idle 10 minutes → the station is available again. An unfinished workout
     is discarded.

Terminal commands while running: a connect code, `end` (disconnect the user),
`quit`.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

from recorder import PairNormalizer, RepThresholds, SessionRecorder
from sources import LibEMGSource, SampleSource, SimulatedSource

APP_DIR = Path(__file__).resolve().parents[1]
ENV_FILE = APP_DIR / ".env"
DEFAULT_API = "https://emg-hackatlantic.vercel.app"
QR_PREFIX = "activatemyo:connect:"

LOOP_HZ = 20  # read + process rate
LIVE_HZ = 5  # live posts per second while a user is connected
HEARTBEAT_S = 5.0
SENSOR_STALE_S = 2.0


# ----------------------------------------------------------------------- env
def load_env() -> None:
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def save_env_value(key: str, value: str) -> None:
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    lines = [ln for ln in lines if not ln.strip().startswith(f"{key}=")] + [f"{key}={value}"]
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key] = value


def ssl_context() -> ssl.SSLContext:
    try:  # python.org builds on macOS ship without root certificates; certifi has them
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ----------------------------------------------------------------------- api
class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class Api:
    """JSON over HTTPS to the web app's /api/station/* endpoints."""

    def __init__(self, base: str, key: str = "") -> None:
        self.base = base.rstrip("/")
        self.key = key
        self.ctx = ssl_context()

    def call(self, method: str, path: str, body: Optional[dict] = None, timeout: float = 15) -> dict:
        headers = {"content-type": "application/json", "user-agent": "activatemyo-station/1"}
        if self.key:
            headers["authorization"] = f"Station {self.key}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(f"{self.base}/api/station/{path}", data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=self.ctx) as resp:
                return json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            try:
                message = json.loads(exc.read().decode("utf-8")).get("error") or exc.reason
            except Exception:
                message = str(exc.reason)
            raise ApiError(exc.code, str(message)) from None
        except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError) as exc:
            raise ApiError(0, f"can't reach {self.base} ({getattr(exc, 'reason', exc)})") from None


# ------------------------------------------------------------------- station
class Station:
    def __init__(self, api: Api, source: SampleSource, thresholds: RepThresholds,
                 calibration: Optional[list[dict]] = None) -> None:
        self.api = api
        self.source = source
        self.thresholds = thresholds
        self.norm = PairNormalizer(calibration)
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.t0 = time.monotonic()
        self.last_seen = [0.0, 0.0]  # per side, monotonic
        # Who is connected (from the server's replies).
        self.user_name: Optional[str] = None
        self.online = False
        # Current recording and the live batch (guarded by self.lock).
        self.session: Optional[SessionRecorder] = None
        self.wall_offset = time.time() - time.monotonic()
        self.batch: list[list[Optional[float]]] = []
        self.last_pct: tuple[Optional[float], Optional[float]] = (None, None)
        self.changed_at = 0.0  # last local connect/disconnect/start; older replies are stale

    # ------------------------------------------------------------- status
    @property
    def connected(self) -> bool:
        return self.user_name is not None

    def sensors(self) -> dict:
        now = time.monotonic()
        return {"left": now - self.last_seen[0] < SENSOR_STALE_S, "right": now - self.last_seen[1] < SENSOR_STALE_S}

    def apply_status(self, reply: dict, sent_at: float) -> None:
        """Every server reply says who is connected and what is being recorded.
        Replies to requests sent before our last local change are ignored."""
        if sent_at < self.changed_at:
            return
        was = self.user_name
        self.user_name = reply.get("user_name") if reply.get("status") == "in_use" else None
        if self.user_name != was:
            if self.user_name:
                log(f"Connected: {self.user_name}. Start the workout on the phone.")
            else:
                log("Disconnected. The station is available — show a QR code to connect.")
        with self.lock:
            s = self.session
            if s is not None and reply.get("recording_session_id") != s.session_id:
                log("Recording discarded (cancelled, disconnected or timed out).")
                self.session = None
            if not self.user_name:
                self.batch = []

    # ------------------------------------------------------------- commands
    def handle(self, cmd: dict) -> None:
        kind, sid = cmd.get("type"), cmd.get("session_id")
        now = time.monotonic()
        if kind == "start":
            with self.lock:
                if self.session is not None and self.session.session_id == sid:
                    return
                self.session = SessionRecorder(
                    session_id=str(sid),
                    exercise_name=str(cmd.get("exercise_name") or "Workout"),
                    left_label=str(cmd.get("left_label") or "Left"),
                    right_label=str(cmd.get("right_label") or "Right"),
                    started_at=now,
                    thresholds=self.thresholds,
                )
                self.changed_at = now
            log(f"Recording {self.session.exercise_name} — set 1")
        elif kind == "next_set":
            with self.lock:
                s = self.session
                if s is None or s.session_id != sid:
                    return
                done = s.next_set(now)
            log(f"Set {done.set_number}: {done.reps} reps, {round(done.tut_s)} s under tension")
            if done.kept:  # rest time is only known later; the summary fills it in
                self.post_retry("set", {"session_id": sid, "set": done.to_payload()})
        elif kind == "finish":
            with self.lock:
                s = self.session
                if s is None or s.session_id != sid:
                    return
                summary = s.finish(now)
                self.session = None
            ended = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(summary["ended_at"] + self.wall_offset))
            body = {"session_id": sid, "ended_at": ended, "activation_score": summary["activation_score"],
                    "sets": summary["sets"]}
            if self.post_retry("finish", body):
                log(f"Saved: {len(summary['sets'])} sets, activation score {summary['activation_score']}")
        elif kind == "cancel":
            with self.lock:
                if self.session is not None and self.session.session_id == sid:
                    self.session = None
                    why = {"user": "cancelled on the phone", "disconnect": "discarded — the user disconnected",
                           "timeout": "discarded — 10 minutes without activity"}.get(str(cmd.get("reason")), "discarded")
                    log(f"Recording {why}.")

    def post_retry(self, path: str, body: dict, tries: int = 3) -> bool:
        for attempt in range(tries):
            try:
                self.api.call("POST", path, body)
                return True
            except ApiError as exc:
                if exc.status and exc.status < 500:  # rejected (e.g. cancelled meanwhile): don't retry
                    log(f"Could not save ({path}): {exc}")
                    return False
                log(f"Saving ({path}) failed, retrying: {exc}")
                time.sleep(1 + attempt * 2)
        return False

    # ------------------------------------------------------------- threads
    def commands_forever(self) -> None:
        while not self.stop.is_set():
            try:
                sent = time.monotonic()
                reply = self.api.call("GET", "commands", timeout=20)
                self.online = True
                cmd = reply.get("command")
                if cmd:
                    self.handle(cmd)
                self.apply_status(reply, sent)
            except ApiError as exc:
                self.online = False
                log(f"Command check failed: {exc}")
                self.stop.wait(3)

    def heartbeat_forever(self) -> None:
        while not self.stop.is_set():
            try:
                sent = time.monotonic()
                self.apply_status(self.api.call("POST", "heartbeat", {"sensors": self.sensors()}), sent)
                self.online = True
            except ApiError as exc:
                self.online = False
                log(f"Heartbeat failed: {exc}")
            self.stop.wait(HEARTBEAT_S)

    def sample_forever(self) -> None:
        while not self.stop.is_set():
            for t, left_raw, right_raw in self.source.read():
                left, right = self.norm.update(left_raw, right_raw)
                if left is not None:
                    self.last_seen[0] = t
                if right is not None:
                    self.last_seen[1] = t
                with self.lock:
                    self.last_pct = (left, right)
                    if self.session is not None:
                        self.session.feed(t, left, right)
                    if self.connected:
                        self.batch.append([round((t - self.t0) * 1000),
                                           None if left_raw is None else round(left_raw, 1),
                                           None if right_raw is None else round(right_raw, 1)])
                        del self.batch[:-2000]
            self.stop.wait(1.0 / LOOP_HZ)

    def live_forever(self) -> None:
        while not self.stop.is_set():
            started = time.monotonic()
            if self.connected:
                with self.lock:
                    batch, self.batch = self.batch, []
                    left, right = self.last_pct
                    metrics: dict[str, Any] = {
                        "left_pct": None if left is None else round(left),
                        "right_pct": None if right is None else round(right),
                        "recording": self.session is not None,
                        **(self.session.live() if self.session is not None else {}),
                    }
                try:
                    self.api.call("POST", "live", {"metrics": metrics, "samples": batch}, timeout=5)
                except ApiError as exc:
                    if exc.status != 0:
                        log(f"Live update failed: {exc}")
            self.stop.wait(max(0.0, 1.0 / LIVE_HZ - (time.monotonic() - started)))

    # ------------------------------------------------------------- connect/end
    def claim(self, code: str) -> bool:
        try:
            reply = self.api.call("POST", "claim", {"code": code})
            self.changed_at = time.monotonic()
            self.apply_status(reply, self.changed_at)
            return True
        except ApiError as exc:
            log(f"Code not accepted: {exc}")
            return False

    def release(self) -> None:
        try:
            reply = self.api.call("POST", "release", {})
            self.changed_at = time.monotonic()
            self.apply_status({**reply, "recording_session_id": None}, self.changed_at)
        except ApiError as exc:
            log(f"Disconnect failed: {exc}")

    def start_threads(self) -> None:
        for fn in (self.heartbeat_forever, self.commands_forever, self.sample_forever, self.live_forever):
            threading.Thread(target=fn, daemon=True, name=fn.__name__).start()


# --------------------------------------------------------------------- camera
class QrScanner:
    """Webcam QR reader (OpenCV, installed with LibEMG). Opened only while the
    station is available; on macOS the window must live on the main thread."""

    def __init__(self, index: int, window: bool) -> None:
        import cv2

        self.cv2 = cv2
        self.index, self.window = index, window
        self.cap: Any = None
        # The ArUco-based detector (OpenCV >= 4.8) finds codes the classic one misses.
        self.detectors = [cv2.QRCodeDetector()] + ([cv2.QRCodeDetectorAruco()] if hasattr(cv2, "QRCodeDetectorAruco") else [])
        self.failed = False

    def open(self) -> bool:
        if self.cap is None and not self.failed:
            self.cap = self.cv2.VideoCapture(self.index)
            if not self.cap.isOpened():
                self.cap, self.failed = None, True
                log("Camera not available — type the code shown on the phone instead. "
                    "(macOS: allow camera access for Terminal in System Settings → Privacy & Security → Camera.)")
        return self.cap is not None

    def close(self) -> None:
        if self.cap is not None:
            self.cap.release()
            self.cap = None
            if self.window:
                self.cv2.destroyAllWindows()
                self.cv2.waitKey(1)

    def scan(self, status_line: str) -> Optional[str]:
        """One frame: returns the decoded connect code, if any."""
        if not self.open():
            return None
        ok, frame = self.cap.read()
        if not ok:
            return None
        text, points = decode_qr(self.detectors, frame, self.cv2.error)
        if self.window:
            if points is not None:
                pts = points.astype(int).reshape(-1, 2)
                self.cv2.polylines(frame, [pts], True, (201, 184, 127), 3)
            self.cv2.putText(frame, status_line, (16, 36), self.cv2.FONT_HERSHEY_SIMPLEX, 0.8, (201, 184, 127), 2)
            self.cv2.imshow("activateMyo station", frame)
            self.cv2.waitKey(1)
        return text if text and text.lower().startswith(QR_PREFIX) else None


def decode_qr(detectors: list, frame: Any, cv_error: type = Exception) -> tuple[str, Any]:
    """First detector that decodes the frame wins: (text, corner points)."""
    points = None
    for detector in detectors:
        try:
            text, pts, _ = detector.detectAndDecode(frame)
        except cv_error:
            continue
        if pts is not None:
            points = pts
        if text:
            return text, pts
    return "", points


# ---------------------------------------------------------------------- main
def load_tuning() -> tuple[RepThresholds, Optional[list[dict]]]:
    """Optional `recording:` section of config.yml (rep thresholds, calibration)."""
    import yaml

    raw = yaml.safe_load((APP_DIR / "config.yml").read_text(encoding="utf-8")) or {}
    rec = raw.get("recording") or {}
    th = RepThresholds(**{k: float(v) for k, v in (rec.get("rep_thresholds") or {}).items()})
    cal = rec.get("calibration")
    calibration = [cal.get("left") or {}, cal.get("right") or {}] if isinstance(cal, dict) else None
    return th, calibration


def ensure_registered(api: Api, name: Optional[str]) -> None:
    key = os.environ.get("STATION_KEY", "")
    if key:
        api.key = key
        return
    name = name or os.environ.get("STATION_NAME") or f"{socket.gethostname().split('.')[0]} station"
    try:
        reply = api.call("POST", "register", {"name": name[:60]})
    except ApiError as exc:
        raise SystemExit(f"Could not register this station with {api.base}: {exc}")
    save_env_value("STATION_ID", reply["station_id"])
    save_env_value("STATION_NAME", reply["name"])
    save_env_value("STATION_KEY", reply["station_key"])
    api.key = reply["station_key"]
    log(f"Registered new station \"{reply['name']}\" (saved to {ENV_FILE}).")


def stdin_forever(lines: "queue.Queue[str]") -> None:
    for line in sys.stdin:
        lines.put(line.strip())
    lines.put("quit")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--simulate", action="store_true", help="use a synthetic signal instead of the sensors")
    parser.add_argument("--name", help="station name shown to users (first run only)")
    parser.add_argument("--api", help=f"web app URL (default STATION_API_URL or {DEFAULT_API})")
    parser.add_argument("--camera", type=int, default=0, help="webcam index (default 0)")
    parser.add_argument("--no-camera", action="store_true", help="don't scan QR codes; type the code instead")
    parser.add_argument("--no-window", action="store_true", help="scan without showing the camera window")
    parser.add_argument("--code", help="connect this code right away (testing)")
    args = parser.parse_args()

    load_env()
    api = Api(args.api or os.environ.get("STATION_API_URL") or DEFAULT_API)
    ensure_registered(api, args.name)
    try:
        api.call("POST", "heartbeat", {"sensors": {}})
    except ApiError as exc:
        if exc.status == 401:
            raise SystemExit("This station's key was rejected. Delete STATION_ID / STATION_KEY from "
                             f"{ENV_FILE} and run again to register it anew.")
        log(f"Web app not reachable yet ({exc}); will keep trying.")

    thresholds, calibration = load_tuning()
    source: SampleSource = SimulatedSource() if args.simulate else LibEMGSource()
    station = Station(api, source, thresholds, calibration)
    station.start_threads()

    scanner: Optional[QrScanner] = None
    if not args.no_camera:
        try:
            scanner = QrScanner(args.camera, window=not args.no_window)
        except ImportError:
            log("OpenCV is not installed — type the code shown on the phone instead.")

    name = os.environ.get("STATION_NAME", "Station")
    print(f"\n  activateMyo station \"{name}\" → {api.base}\n"
          f"  Sign in on your phone → Workout → Connect to station, then "
          f"{'show the QR code to the camera or ' if scanner else ''}type the code here.\n"
          "  Commands: <code> · end (disconnect user) · quit\n", flush=True)

    lines: "queue.Queue[str]" = queue.Queue()
    threading.Thread(target=stdin_forever, args=(lines,), daemon=True, name="stdin").start()
    if args.code:
        lines.put(args.code)
    last_tried: dict[str, float] = {}
    try:
        while True:
            try:
                line = lines.get(timeout=0.03 if scanner else 0.5)
            except queue.Empty:
                line = None
            if line:
                word = line.lower()
                if word in ("quit", "exit", "q"):
                    break
                if word in ("end", "logout", "disconnect"):
                    if station.connected:
                        station.release()
                    else:
                        log("Nobody is connected.")
                elif station.connected:
                    log(f"{station.user_name} is connected — type `end` first to connect someone else.")
                else:
                    station.claim(line)
            if scanner is not None:
                if station.connected:
                    scanner.close()
                else:
                    code = scanner.scan("Show your activateMyo QR code" if station.online else "Offline — retrying")
                    if code and time.monotonic() - last_tried.get(code, -99) > 5:
                        last_tried[code] = time.monotonic()
                        log("QR code seen — connecting…")
                        station.claim(code)
    except KeyboardInterrupt:
        pass
    finally:
        station.stop.set()
        if scanner is not None:
            scanner.close()
        if station.connected:
            log("Disconnecting the user before exit…")
            station.release()
        print("Bye.", flush=True)


if __name__ == "__main__":
    import multiprocessing as mp

    mp.freeze_support()  # the real-sensor path starts a streamer subprocess
    main()
