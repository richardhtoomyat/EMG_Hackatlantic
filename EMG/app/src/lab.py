"""Baseline and strain recordings (Kiril's recording feature) for station.py.

Same maths and output shape as Kiril's original run.py (`/end_passive`,
`/end_strain`), which this replaces, so recordings saved by either play back
the same way:

  * baseline: per sensor, the median and MAD (median absolute deviation) of the
    relaxed-muscle signal.
  * strain: per sensor, each sample above "rest" = baseline median + 3·|MAD|,
    as a % of that sensor's strongest above-rest sample in the recording.

Rows are (left raw, right raw) in config.yml sensor order; None = no reading.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite
from statistics import median
from typing import Optional, Sequence

Row = tuple[Optional[float], Optional[float]]
MAX_ROWS = 12_000  # ~10 min at 20 Hz; keeps the upload well under Vercel's limit


def _valid(v: Optional[float], missing: float) -> bool:
    return v is not None and isfinite(v) and v != missing


def summarize_baseline(rows: Sequence[Row], names: Sequence[str], duration_s: float,
                       missing: float = -1.0) -> dict:
    """run.py /end_passive: {sample_count, duration_s, channels: {name: {sample_count, median, mad}}}."""
    channels: dict[str, dict] = {}
    for i, name in enumerate(names):
        values = [r[i] for r in rows if i < len(r) and _valid(r[i], missing)]
        if not values:
            channels[name] = {"sample_count": 0}
            continue
        m = float(median(values))
        channels[name] = {
            "sample_count": len(values),
            "median": m,
            "mad": float(median(abs(v - m) for v in values)),
        }
    return {"sample_count": len(rows), "duration_s": float(duration_s), "channels": channels}


def summarize_strain(rows: Sequence[Row], names: Sequence[str], duration_s: float,
                     selections: Sequence[dict], missing: float = -1.0) -> dict:
    """run.py /end_strain: {recordings: [{channel, muscle_id, baseline, duration_s, sample_count, readings}]}."""
    recordings = []
    for sel in selections:
        index = list(names).index(sel["channel"])
        rest_threshold = float(sel["median"]) + 3 * abs(float(sel.get("mad", 0.0)))
        values = [r[index] if index < len(r) else None for r in rows]
        above_rest = [(i, float(v), max(0.0, float(v) - rest_threshold))
                      for i, v in enumerate(values) if _valid(v, missing)]
        peak = max((a for _, _, a in above_rest), default=0.0)
        denominator = max(len(values) - 1, 1)
        readings = [
            {
                "time_s": duration_s * i / denominator,
                "raw": v,
                "above_rest": round(a, 3),
                "strain_pct": round(a / peak * 100, 1) if peak > 0 else 0.0,
            }
            for i, v, a in above_rest
        ]
        recordings.append({
            "channel": sel["channel"],
            "muscle_id": sel["muscle_id"],
            "baseline": float(sel["median"]),
            "duration_s": float(duration_s),
            "sample_count": len(readings),
            "readings": readings,
        })
    return {"recordings": recordings}


@dataclass
class LabRecording:
    """A baseline or strain recording in progress on the station."""

    mode: str  # "baseline" | "strain"
    started_at: float  # monotonic
    placements: dict = field(default_factory=dict)  # baseline: {sensor: muscle id | None}
    selections: list = field(default_factory=list)  # strain: [{channel, muscle_id, median, mad}]
    rows: list = field(default_factory=list)

    def add(self, left: Optional[float], right: Optional[float]) -> None:
        if len(self.rows) < MAX_ROWS:
            self.rows.append((left, right))

    def result(self, ended_at: float, names: Sequence[str], missing: float = -1.0) -> tuple[int, dict]:
        """(emg_recordings.recording_type, raw_data) — 0 baseline, 1 strain."""
        duration = max(0.0, ended_at - self.started_at)
        if self.mode == "baseline":
            return 0, {**summarize_baseline(self.rows, names, duration, missing), "placements": self.placements}
        return 1, summarize_strain(self.rows, names, duration, self.selections, missing)


# ---------------------------------------------------------------------------
# Calibration (Workout tab, e.g. Bicep Curl): relax, then squeeze as hard as possible.

CALIB_SKIP_S = 1.0  # ignore the first second of each step (reaction time)
CALIB_MIN_SAMPLES = 10
CALIB_MIN_SPAN = 30.0  # raw units: max must clear rest by at least this much...
CALIB_MIN_SPAN_MADS = 5.0  # ...and by this many rest MADs


def _percentile(values: list[float], q: float) -> float:
    s = sorted(values)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def summarize_calibration(rows: Sequence[tuple[float, Optional[float], Optional[float]]], started: float,
                          mark: float, ended: float, names: Sequence[str], missing: float = -1.0) -> dict:
    """Rows are (time, left raw, right raw). Rest = started..mark, squeeze = mark..ended.

    Per side: rest = median and mad of the relaxed signal, mvc = 95th percentile
    of the squeeze (robust to a single spike). ok when the squeeze clears rest by
    max(CALIB_MIN_SPAN, CALIB_MIN_SPAN_MADS · mad).
    """
    sides: dict[str, dict] = {}
    for i, side in enumerate(("left", "right")):
        rest = [r[i + 1] for r in rows if started + CALIB_SKIP_S <= r[0] < mark and _valid(r[i + 1], missing)]
        squeeze = [r[i + 1] for r in rows if mark + CALIB_SKIP_S <= r[0] <= ended and _valid(r[i + 1], missing)]
        name = names[i] if i < len(names) else side
        if len(rest) < CALIB_MIN_SAMPLES or len(squeeze) < CALIB_MIN_SAMPLES:
            sides[side] = {"sensor": name, "ok": False, "problem": "no signal from this sensor"}
            continue
        r_med = float(median(rest))
        mad = float(median(abs(v - r_med) for v in rest))
        mvc = float(_percentile(squeeze, 0.95))
        need = max(CALIB_MIN_SPAN, CALIB_MIN_SPAN_MADS * mad)
        ok = mvc - r_med >= need
        sides[side] = {
            "sensor": name, "ok": ok, "rest": round(r_med, 2), "mad": round(mad, 2), "mvc": round(mvc, 2),
            "rest_samples": len(rest), "squeeze_samples": len(squeeze),
            **({} if ok else {"problem": "the squeeze was barely above rest — squeeze harder or check the sensor"}),
        }
    return {
        "rest_s": round(max(0.0, mark - started), 1),
        "squeeze_s": round(max(0.0, ended - mark), 1),
        "sides": sides,
        "ok": all(s["ok"] for s in sides.values()),
    }
