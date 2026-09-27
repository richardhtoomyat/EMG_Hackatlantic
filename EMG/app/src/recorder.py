"""Turns a stream of left/right envelope readings into sets, reps and a session summary.

Pure logic (no I/O), so it can be unit-tested and used with real sensors or the
simulator alike. Units: envelope values are whatever the MyoWare firmware sends;
`ChannelNormalizer` maps them to 0-100 % activation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


def _clip(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


@dataclass
class ChannelNormalizer:
    """Maps a raw envelope value to 0-100 %.

    With `rest`/`mvc` set (from config.yml calibration) the mapping is fixed.
    Otherwise it adapts: the floor tracks the resting level and the ceiling the
    strongest contraction seen, so percentages mean "share of your best effort
    this session" until a real calibration is added.
    """

    rest: Optional[float] = None
    mvc: Optional[float] = None
    smoothing: float = 0.3  # EMA factor applied to the raw envelope
    min_range: float = 50.0  # raw units; avoids huge % from noise before the first rep
    _ema: Optional[float] = None
    _floor: Optional[float] = None
    _ceiling: Optional[float] = None

    def update(self, raw: Optional[float]) -> Optional[float]:
        if raw is None:
            return None
        self._ema = raw if self._ema is None else self._ema + self.smoothing * (raw - self._ema)
        x = self._ema
        if self.rest is not None and self.mvc is not None and self.mvc > self.rest:
            return _clip((x - self.rest) / (self.mvc - self.rest) * 100.0)

        if self._floor is None:
            self._floor, self._ceiling = x, x + self.min_range
        # Floor follows drops immediately and creeps up slowly (drifting baseline).
        self._floor = x if x < self._floor else self._floor + (x - self._floor) * 0.0005
        # Ceiling follows peaks immediately and relaxes very slowly.
        if x > self._ceiling:
            self._ceiling = x
        else:
            self._ceiling -= (self._ceiling - self._floor) * 0.0001
        self._ceiling = max(self._ceiling, self._floor + self.min_range)
        return _clip((x - self._floor) / (self._ceiling - self._floor) * 100.0)


class PairNormalizer:
    """Normalises the left and right channels together.

    Each side keeps its own resting floor (sensors sit at different baselines),
    but in adaptive mode both share ONE scale, so a genuinely weaker side shows
    a lower % and the L/R imbalance survives. (Scaling each side to its own
    maximum would make both reach 100 % and hide the imbalance.) With per-side
    `rest`/`mvc` from a calibration, each side uses its own fixed mapping.
    """

    def __init__(self, calibration: Optional[list[dict]] = None, smoothing: float = 0.3,
                 min_range: float = 50.0) -> None:
        cal = (calibration or []) + [{}, {}]
        self.fixed = [ChannelNormalizer(rest=c.get("rest"), mvc=c.get("mvc"), smoothing=smoothing)
                      for c in cal[:2]]
        self.calibrated = [f.rest is not None and f.mvc is not None and f.mvc > f.rest for f in self.fixed]
        self.smoothing, self.min_range = smoothing, min_range
        self._ema: list[Optional[float]] = [None, None]
        self._floor: list[Optional[float]] = [None, None]
        self._range = min_range

    def update(self, left: Optional[float], right: Optional[float]) -> tuple[Optional[float], Optional[float]]:
        out: list[Optional[float]] = []
        for i, raw in enumerate((left, right)):
            if raw is None:
                out.append(None)
                continue
            if self.calibrated[i]:
                out.append(self.fixed[i].update(raw))
                continue
            ema = raw if self._ema[i] is None else self._ema[i] + self.smoothing * (raw - self._ema[i])
            self._ema[i] = ema
            floor = self._floor[i]
            floor = ema if floor is None or ema < floor else floor + (ema - floor) * 0.0005
            self._floor[i] = floor
            above = ema - floor
            if above > self._range:
                self._range = above  # shared by both sides
            out.append(_clip(above / self._range * 100.0))
        # The shared scale relaxes very slowly towards the minimum range.
        self._range = max(self.min_range, self._range - (self._range - self.min_range) * 0.0001)
        return out[0], out[1]


@dataclass
class RepThresholds:
    on_pct: float = 40.0  # combined activation that starts a rep
    off_pct: float = 20.0  # ...and ends it (hysteresis avoids double counting)
    min_rep_s: float = 0.4  # shorter bursts are ignored as twitches


@dataclass
class SetTracker:
    """Accumulates one set: reps, time under tension, peak and mean activation."""

    set_number: int
    started_at: float
    left_label: str
    right_label: str
    thresholds: RepThresholds = field(default_factory=RepThresholds)
    ended_at: Optional[float] = None
    reps: int = 0
    tut_s: float = 0.0
    peak_pct: float = 0.0
    _last_t: Optional[float] = None
    _in_rep: bool = False
    _rep_start: float = 0.0
    _active_sum: float = 0.0
    _active_n: int = 0
    _left: list[float] = field(default_factory=list)
    _right: list[float] = field(default_factory=list)
    last_left: Optional[float] = None
    last_right: Optional[float] = None
    first_active_t: Optional[float] = None  # first/last moment above the "off" threshold,
    last_active_t: Optional[float] = None  # used for rest time between sets

    def feed(self, t: float, left: Optional[float], right: Optional[float]) -> None:
        present = [v for v in (left, right) if v is not None]
        if not present:
            self._last_t = t
            return
        combined = sum(present) / len(present)
        self.last_left, self.last_right = left, right
        dt = 0.0 if self._last_t is None else max(0.0, min(t - self._last_t, 0.5))
        self._last_t = t
        self.peak_pct = max(self.peak_pct, combined)

        th = self.thresholds
        if combined >= th.off_pct:
            if self.first_active_t is None:
                self.first_active_t = t
            self.last_active_t = t
            self.tut_s += dt
            self._active_sum += combined
            self._active_n += 1
            if left is not None:
                self._left.append(left)
            if right is not None:
                self._right.append(right)
        if not self._in_rep and combined >= th.on_pct:
            self._in_rep, self._rep_start = True, t
        elif self._in_rep and combined < th.off_pct:
            self._in_rep = False
            if t - self._rep_start >= th.min_rep_s:
                self.reps += 1

    def close(self, t: float) -> None:
        self.ended_at = t

    @property
    def contraction_pct(self) -> float:
        return self._active_sum / self._active_n if self._active_n else 0.0

    def side_means(self) -> tuple[Optional[float], Optional[float]]:
        mean = lambda xs: sum(xs) / len(xs) if xs else None  # noqa: E731
        return mean(self._left), mean(self._right)

    def imbalance_pct(self) -> float:
        left, right = self.side_means()
        if left is None or right is None or max(left, right) <= 0:
            return 0.0
        return abs(left - right) / max(left, right) * 100.0

    @property
    def kept(self) -> bool:
        """False for an empty set (e.g. "Next set" pressed twice); it is not saved."""
        return self.reps > 0 or self.tut_s >= 1.0

    def to_payload(self, recovery_s: float = 0.0) -> dict:
        return {
            "set_number": self.set_number,
            "reps": self.reps,
            "time_under_tension_sec": round(self.tut_s),
            "peak_activation_pct": round(self.peak_pct),
            "contraction_pct": round(self.contraction_pct),
            "recovery_sec": round(recovery_s),
            "muscle_pct": self.muscle_pct(),
        }

    def muscle_pct(self) -> dict[str, int]:
        left, right = self.side_means()
        out: dict[str, int] = {}
        if left is not None:
            out[self.left_label] = round(left)
        if right is not None:
            out[self.right_label] = round(right)
        return out


@dataclass
class SessionRecorder:
    """A recording session: a list of sets, the current one open."""

    session_id: str
    exercise_name: str
    left_label: str
    right_label: str
    started_at: float
    thresholds: RepThresholds = field(default_factory=RepThresholds)
    sets: list[SetTracker] = field(default_factory=list)
    ended_at: Optional[float] = None

    def __post_init__(self) -> None:
        self._open_set(self.started_at)

    @property
    def current(self) -> SetTracker:
        return self.sets[-1]

    def _open_set(self, t: float) -> None:
        self.sets.append(
            SetTracker(len(self.sets) + 1, t, self.left_label, self.right_label, self.thresholds)
        )

    def feed(self, t: float, left: Optional[float], right: Optional[float]) -> None:
        self.current.feed(t, left, right)

    def next_set(self, t: float) -> SetTracker:
        done = self.current
        done.close(t)
        self._open_set(t)
        return done

    def finish(self, t: float) -> dict:
        self.current.close(t)
        self.ended_at = t
        return self.summary()

    def kept_sets(self) -> list[SetTracker]:
        return [s for s in self.sets if s.kept]

    @staticmethod
    def recovery(prev: SetTracker, nxt: Optional[SetTracker]) -> float:
        """Rest between two sets: last activity of one to first activity of the next."""
        if nxt is None:
            return 0.0
        end = prev.last_active_t or prev.ended_at or nxt.started_at
        start = nxt.first_active_t or nxt.started_at
        return max(0.0, start - end)

    def summary(self) -> dict:
        """Snake_case summary; the web app maps it onto sessions/sets rows."""
        sets = self.kept_sets()
        out_sets = [
            s.to_payload(self.recovery(s, sets[i + 1] if i + 1 < len(sets) else None))
            for i, s in enumerate(sets)
        ]
        avg_contraction = sum(s.contraction_pct for s in sets) / len(sets) if sets else 0.0
        avg_imbalance = sum(s.imbalance_pct() for s in sets) / len(sets) if sets else 0.0
        # 0-100: mostly how hard the muscles worked, partly how evenly both sides did.
        score = round(_clip(0.7 * avg_contraction + 0.3 * (100.0 - avg_imbalance))) if sets else 0
        return {
            "session_id": self.session_id,
            "exercise_name": self.exercise_name,
            "started_at": self.started_at,
            "ended_at": self.ended_at or self.current.ended_at or self.started_at,
            "activation_score": score,
            "sets": out_sets,
        }

    def live(self) -> dict:
        s = self.current
        left_avg, right_avg = s.side_means()
        return {
            "left_avg_pct": None if left_avg is None else round(left_avg),
            "right_avg_pct": None if right_avg is None else round(right_avg),
            "set_number": s.set_number,
            "left_pct": None if s.last_left is None else round(s.last_left),
            "right_pct": None if s.last_right is None else round(s.last_right),
            "imbalance_pct": round(s.imbalance_pct()),
            "reps": s.reps,
            "tut_sec": round(s.tut_s),
            "peak_pct": round(s.peak_pct),
            "completed_sets": len(self.sets) - 1,
        }
