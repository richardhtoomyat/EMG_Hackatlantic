"""Where left/right envelope samples come from: the real MyoWare rig (via the
LibEMG shared-memory buffer filled by streamer.py) or a simulator for testing
the whole pipeline without hardware.
"""

from __future__ import annotations

import math
import random
import time
from typing import Optional, Protocol

Sample = tuple[float, Optional[float], Optional[float]]  # (monotonic time, left raw, right raw)


class SampleSource(Protocol):
    def read(self) -> list[Sample]:
        """Return all samples that arrived since the previous call, oldest first."""
        ...


class LibEMGSource:
    """Reads new rows from the LibEMG OnlineDataHandler started by streamer.py.

    Channel 0 is the first sensor in config.yml (left), channel 1 the second
    (right). The firmware's missing value (-1) becomes None.
    """

    def __init__(self, missing_value: float = -1.0, nominal_rate_hz: float = 20.0) -> None:
        from streamer import get_online_handler, load_config  # lazy: pulls in libemg + bleak

        self.config = load_config()
        self.handler = get_online_handler()
        self.missing = missing_value
        self.dt = 1.0 / nominal_rate_hz  # only used for the very first batch
        self.last_count = 0
        self.last_read: Optional[float] = None

    def read(self) -> list[Sample]:
        data, count = self.handler.get_data()
        emg, total = data["emg"], int(count["emg"][0][0])
        new = max(0, min(total - self.last_count, emg.shape[0]))
        self.last_count = total
        if new == 0:
            return []
        rows = emg[:new][::-1]  # LibEMG buffers are newest-first
        now = time.monotonic()
        # The buffer carries no timestamps: spread this batch evenly over the time
        # since the previous read, so times stay increasing whatever rate the
        # shields actually send at (the first batch assumes the nominal rate).
        start = self.last_read if self.last_read is not None else now - new * self.dt
        step = (now - start) / new
        self.last_read = now
        out: list[Sample] = []
        for i, row in enumerate(rows):
            vals = [None if v == self.missing else float(v) for v in row]
            left = vals[0] if len(vals) > 0 else None
            right = vals[1] if len(vals) > 1 else None
            out.append((start + (i + 1) * step, left, right))
        return out


class SimulatedSource:
    """Synthetic envelope: resting noise plus a rep every few seconds while
    "lifting", with the left side a little stronger than the right."""

    def __init__(self, rate_hz: float = 20.0, rest: float = 80.0, peak: float = 700.0,
                 imbalance: float = 0.18, rep_period_s: float = 3.2, seed: Optional[int] = None) -> None:
        self.dt = 1.0 / rate_hz
        self.rest, self.peak, self.imbalance, self.period = rest, peak, imbalance, rep_period_s
        self.rng = random.Random(seed)
        self.t0 = time.monotonic()
        self.next_t = self.t0

    def _value(self, t: float, gain: float) -> float:
        phase = ((t - self.t0) % self.period) / self.period
        # Contraction for the first ~55% of each rep cycle, rest for the remainder.
        burst = math.sin(math.pi * phase / 0.55) ** 2 if phase < 0.55 else 0.0
        fatigue = 1.0 - min(0.25, (t - self.t0) / 600.0)  # slow decline over 10 minutes
        return self.rest + (self.peak - self.rest) * burst * gain * fatigue + self.rng.gauss(0, 12)

    def read(self) -> list[Sample]:
        now = time.monotonic()
        out: list[Sample] = []
        while self.next_t <= now:
            t = self.next_t
            out.append((t, self._value(t, 1.0), self._value(t, 1.0 - self.imbalance)))
            self.next_t += self.dt
        return out
