"""lab.py must give the same numbers as Kiril's run.py / muscle_activation_recording.py."""

import os
import random
import sys
from math import isfinite

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from lab import LabRecording, summarize_baseline, summarize_strain  # noqa: E402

NAMES = ["MyoWareSensorL", "MyoWareSensorR"]
MISSING = -1.0


def rows(n=400, seed=1):
    rng = random.Random(seed)
    out = []
    for i in range(n):
        left = 80 + rng.gauss(0, 6) + (300 if 100 < i < 180 else 0)
        right = None if i % 17 == 0 else 95 + rng.gauss(0, 5) + (220 if 120 < i < 200 else 0)
        out.append((left, right))
    return out


def as_array(rs):
    return np.array([[MISSING if v is None else v for v in r] for r in rs], dtype=np.float64)


def kiril_baseline(data):
    """muscle_activation_recording.summarize_rest, per channel."""
    out = {}
    for i, name in enumerate(NAMES):
        values = data[:, i]
        valid = values[np.isfinite(values) & (values != MISSING)]
        med = float(np.median(valid))
        out[name] = {"sample_count": int(valid.size), "median": med, "mad": float(np.median(np.abs(valid - med)))}
    return out


def kiril_strain(samples, duration_s, selections):
    """run.py /end_strain loop, verbatim logic."""
    recordings = []
    for sel in selections:
        channel_index = NAMES.index(sel["channel"])
        rest_threshold = sel["median"] + 3 * abs(sel["mad"])
        values = samples[:, channel_index]
        valid = [(index, float(value)) for index, value in enumerate(values) if isfinite(value) and value != MISSING]
        above_rest = [(index, value, max(0.0, value - rest_threshold)) for index, value in valid]
        set_peak = max((activity for _, _, activity in above_rest), default=0.0)
        denominator = max(len(values) - 1, 1)
        readings = [
            {
                "time_s": duration_s * index / denominator,
                "raw": value,
                "above_rest": round(activity, 3),
                "strain_pct": round(activity / set_peak * 100, 1) if set_peak > 0 else 0.0,
            }
            for index, value, activity in above_rest
        ]
        recordings.append({"channel": sel["channel"], "muscle_id": sel["muscle_id"], "baseline": sel["median"],
                           "duration_s": duration_s, "sample_count": len(readings), "readings": readings})
    return {"recordings": recordings}


def test_baseline_matches_kiril():
    rs = rows(301)
    ours = summarize_baseline(rs, NAMES, 5.0, MISSING)
    assert ours["sample_count"] == 301 and ours["duration_s"] == 5.0
    for name, ref in kiril_baseline(as_array(rs)).items():
        assert ours["channels"][name]["sample_count"] == ref["sample_count"]
        assert abs(ours["channels"][name]["median"] - ref["median"]) < 1e-9
        assert abs(ours["channels"][name]["mad"] - ref["mad"]) < 1e-9


def test_baseline_without_data():
    ours = summarize_baseline([(None, 90.0), (None, 91.0)], NAMES, 1.0, MISSING)
    assert ours["channels"]["MyoWareSensorL"] == {"sample_count": 0}
    assert ours["channels"]["MyoWareSensorR"]["median"] == 90.5


def test_strain_matches_kiril():
    rs = rows(400, seed=7)
    sels = [
        {"channel": "MyoWareSensorL", "muscle_id": "f-bicep-l", "median": 80.0, "mad": 4.0},
        {"channel": "MyoWareSensorR", "muscle_id": "f-bicep-r", "median": 95.0, "mad": 3.5},
    ]
    assert summarize_strain(rs, NAMES, 12.5, sels, MISSING) == kiril_strain(as_array(rs), 12.5, sels)


def test_lab_recording_result_shapes():
    base = LabRecording("baseline", 10.0, placements={"MyoWareSensorL": "f-bicep-l", "MyoWareSensorR": None})
    for r in rows(50):
        base.add(*r)
    rec_type, raw = base.result(15.0, NAMES, MISSING)
    assert rec_type == 0 and raw["duration_s"] == 5.0 and raw["placements"]["MyoWareSensorL"] == "f-bicep-l"

    strain = LabRecording("strain", 0.0, selections=[{"channel": "MyoWareSensorR", "muscle_id": "f-bicep-r",
                                                      "median": 95.0, "mad": 3.0}])
    for r in rows(50):
        strain.add(*r)
    rec_type, raw = strain.result(4.0, NAMES, MISSING)
    assert rec_type == 1 and len(raw["recordings"]) == 1 and raw["recordings"][0]["channel"] == "MyoWareSensorR"
