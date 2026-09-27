"""Run from EMG/app:  python -m pytest tests"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from recorder import ChannelNormalizer, PairNormalizer, SessionRecorder  # noqa: E402
from sources import SimulatedSource  # noqa: E402


def feed_simulated(rec: SessionRecorder, seconds: float, t0: float, imbalance: float = 0.18) -> float:
    """Feed `seconds` of synthetic signal (20 Hz) without real waiting; returns end time."""
    src = SimulatedSource(imbalance=imbalance, seed=1)
    src.t0 = t0
    norm = PairNormalizer()
    t = t0
    while t < t0 + seconds:
        rec.feed(t, *norm.update(src._value(t, 1.0), src._value(t, 1.0 - imbalance)))
        t += 0.05
    return t


def new_session() -> SessionRecorder:
    return SessionRecorder("s1", "Bicep Curl", "Left Bicep", "Right Bicep", started_at=0.0)


def test_normalizer_fixed_calibration():
    n = ChannelNormalizer(rest=100, mvc=600, smoothing=1.0)
    assert n.update(100) == 0 and n.update(350) == 50 and n.update(900) == 100 and n.update(None) is None


def test_pair_normalizer_keeps_imbalance_and_offsets():
    n = PairNormalizer(smoothing=1.0)
    for _ in range(20):
        n.update(80, 200)  # right sensor rests at a higher baseline
    left, right = n.update(700, 200 + 620 * 0.8)  # right contracts 20% less
    assert left == 100 and 75 <= right <= 85


def test_pair_normalizer_uses_calibration_per_side():
    n = PairNormalizer([{"rest": 100, "mvc": 600}, {"rest": 50, "mvc": 450}], smoothing=1.0)
    assert n.update(350, 250) == (50, 50)


def test_normalizer_adaptive_reaches_full_range():
    n = ChannelNormalizer(smoothing=1.0)
    for _ in range(20):
        n.update(80)
    assert n.update(80) < 5
    assert n.update(700) == 100  # strongest seen so far
    assert 40 < n.update(390) < 60


def test_counts_reps_tut_and_imbalance():
    rec = new_session()
    end = feed_simulated(rec, 32.0, 0.0)  # 10 rep cycles of 3.2 s
    s = rec.current
    assert 9 <= s.reps <= 10  # the very first cycle may be below threshold while the scale adapts
    assert 8 <= s.tut_s <= 20  # contraction part of each cycle
    assert 10 <= s.imbalance_pct() <= 30  # left simulated ~18% stronger
    left, right = s.side_means()
    assert left > right
    assert end > 31


def test_sets_summary_and_recovery():
    rec = new_session()
    t = feed_simulated(rec, 16.0, 0.0)
    rec.next_set(t)
    t2 = feed_simulated(rec, 16.0, t + 30.0)  # 30 s of silence first = rest
    rec.next_set(t2)  # empty trailing set, must be dropped
    summary = rec.finish(t2 + 0.1)
    assert [x["set_number"] for x in summary["sets"]] == [1, 2]
    first, second = summary["sets"]
    assert first["reps"] >= 4 and second["reps"] >= 4
    assert 30 <= first["recovery_sec"] <= 34 and second["recovery_sec"] == 0
    assert set(first["muscle_pct"]) == {"Left Bicep", "Right Bicep"}
    assert 0 < summary["activation_score"] <= 100
    assert first["peak_activation_pct"] >= first["contraction_pct"]


def test_one_sensor_only():
    rec = new_session()
    for i in range(200):
        t = i * 0.05
        v = 80 if (i // 40) % 2 else 600
        rec.feed(t, v / 6, None)  # already-normalised % on the left only
    s = rec.current
    assert s.reps >= 2 and s.imbalance_pct() == 0
    assert list(s.muscle_pct()) == ["Left Bicep"]


class FakeHandler:
    """Mimics LibEMG OnlineDataHandler.get_data(): newest-first buffer + total count."""

    def __init__(self, rows: int = 50, channels: int = 2) -> None:
        import numpy as np

        self.np = np
        self.buf = np.zeros((rows, channels))
        self.count = 0

    def push(self, *row: float) -> None:  # same order as streamer.py's _append_sample
        self.buf = self.np.concatenate((self.np.asarray([row], dtype=float), self.buf[:-1]), axis=0)
        self.count += 1

    def get_data(self, N: int = 0):
        data = self.buf if N == 0 else self.buf[:N]
        return {"emg": data}, {"emg": self.np.asarray([[self.count]], dtype=self.np.int32)}


def make_libemg_source(handler: FakeHandler):
    from sources import LibEMGSource

    src = LibEMGSource.__new__(LibEMGSource)  # skip starting BLE / libemg
    src.handler, src.missing, src.dt, src.last_count = handler, -1.0, 0.05, 0
    return src


def test_libemg_source_reads_new_rows_in_order_and_maps_missing():
    h = FakeHandler()
    src = make_libemg_source(h)
    assert src.read() == []
    for i in range(3):
        h.push(100 + i, -1 if i == 1 else 200 + i)
    rows = src.read()
    assert [(l, r) for _, l, r in rows] == [(100, 200), (101, None), (102, 202)]
    assert rows[0][0] < rows[1][0] < rows[2][0]
    assert src.read() == []  # nothing new
    h.push(103, 203)
    assert [(l, r) for _, l, r in src.read()] == [(103, 203)]


def test_libemg_source_caps_at_buffer_size():
    h = FakeHandler(rows=5)
    src = make_libemg_source(h)
    for i in range(12):  # more rows than the buffer holds between reads
        h.push(i, i)
    assert [l for _, l, _ in src.read()] == [7, 8, 9, 10, 11]
