#!/usr/bin/env python3
from pathlib import Path
import subprocess
import sys

RUNTIME_CODE = '"""Live bicep-curl rep counter for ActivateMyo.\n\nLoads a tiny Logistic Regression model exported as JSON by\ntrain_rep_count_model.py. Runtime inference uses only Python + NumPy.\n\nThe model classifies short MyoWare envelope windows as REST vs ACTIVE.\nA hysteresis state machine turns ACTIVE -> REST transitions into reps.\n"""\n\nfrom __future__ import annotations\n\nfrom collections import deque\nfrom pathlib import Path\nimport json\nimport math\n\nimport numpy as np\n\n\ndef normalize_signal(values: np.ndarray, baseline_median: float, baseline_mad: float) -> np.ndarray:\n    scale = max(float(baseline_mad), 1.0)\n    return (np.asarray(values, dtype=np.float64) - float(baseline_median)) / scale\n\n\ndef extract_features(times: np.ndarray, values: np.ndarray) -> np.ndarray:\n    times = np.asarray(times, dtype=np.float64)\n    values = np.asarray(values, dtype=np.float64)\n\n    relative_time = times - times[0]\n    slope = float(np.polyfit(relative_time, values, 1)[0]) if relative_time[-1] > 0 else 0.0\n    diff = np.diff(values)\n\n    return np.asarray(\n        [\n            np.mean(values),\n            np.median(values),\n            np.std(values),\n            np.min(values),\n            np.max(values),\n            np.ptp(values),\n            np.percentile(values, 10),\n            np.percentile(values, 90),\n            np.sqrt(np.mean(values ** 2)),\n            slope,\n            float(np.mean(np.abs(diff))) if diff.size else 0.0,\n            values[-1] - values[0],\n        ],\n        dtype=np.float64,\n    )\n\n\nclass PortableLogisticRegression:\n    def __init__(self, model_path: str | Path) -> None:\n        payload = json.loads(Path(model_path).read_text(encoding="utf-8"))\n        if payload.get("format") != "activatemyo-logreg-v1":\n            raise ValueError("Unsupported ActivateMyo rep model format")\n\n        self.window_seconds = float(payload["window_seconds"])\n        self.stride_seconds = float(payload["stride_seconds"])\n        self.mean = np.asarray(payload["scaler_mean"], dtype=np.float64)\n        self.scale = np.asarray(payload["scaler_scale"], dtype=np.float64)\n        self.coef = np.asarray(payload["coef"], dtype=np.float64)\n        self.intercept = float(payload["intercept"])\n        self.state_machine = dict(payload.get("state_machine") or {})\n        self.training_info = dict(payload.get("training_info") or {})\n\n    def active_probability(self, features: np.ndarray) -> float:\n        standardized = (features - self.mean) / self.scale\n        logit = float(np.dot(self.coef, standardized) + self.intercept)\n        if logit >= 0:\n            z = math.exp(-logit)\n            return 1.0 / (1.0 + z)\n        z = math.exp(logit)\n        return z / (1.0 + z)\n\n\nclass LiveRepCounter:\n    def __init__(\n        self,\n        model_path: str | Path,\n        baseline_median: float,\n        baseline_mad: float,\n    ) -> None:\n        self.model = PortableLogisticRegression(model_path)\n        tuning = self.model.state_machine\n\n        self.window_seconds = self.model.window_seconds\n        self.stride_seconds = self.model.stride_seconds\n        self.active_threshold = float(tuning.get("active_threshold", 0.60))\n        self.rest_threshold = float(tuning.get("rest_threshold", 0.35))\n        self.active_confirm_seconds = float(tuning.get("active_confirm_seconds", 0.10))\n        self.rest_confirm_seconds = float(tuning.get("rest_confirm_seconds", 0.10))\n        self.minimum_rep_duration_seconds = float(tuning.get("minimum_rep_duration_seconds", 0.60))\n        self.refractory_seconds = float(tuning.get("refractory_seconds", 0.35))\n\n        self.baseline_median = float(baseline_median)\n        self.baseline_mad = max(float(baseline_mad), 1.0)\n\n        self.samples: deque[tuple[float, float]] = deque()\n        self.rep_count = 0\n        self.state = "REST"\n        self.active_probability = 0.0\n        self.last_prediction_time = -math.inf\n        self.active_candidate_since: float | None = None\n        self.rest_candidate_since: float | None = None\n        self.rep_started_at: float | None = None\n        self.last_rep_completed_at = -math.inf\n\n    def reset(self) -> None:\n        self.samples.clear()\n        self.rep_count = 0\n        self.state = "REST"\n        self.active_probability = 0.0\n        self.last_prediction_time = -math.inf\n        self.active_candidate_since = None\n        self.rest_candidate_since = None\n        self.rep_started_at = None\n        self.last_rep_completed_at = -math.inf\n\n    def status(self) -> dict[str, object]:\n        return {\n            "rep_count": self.rep_count,\n            "state": self.state,\n            "active_probability": round(self.active_probability, 3),\n        }\n\n    def update(self, timestamp: float, raw_value: float) -> dict[str, object]:\n        timestamp = float(timestamp)\n        raw_value = float(raw_value)\n\n        if not math.isfinite(raw_value):\n            return self.status()\n\n        self.samples.append((timestamp, raw_value))\n        while self.samples and timestamp - self.samples[0][0] > self.window_seconds:\n            self.samples.popleft()\n\n        if timestamp - self.last_prediction_time < self.stride_seconds:\n            return self.status()\n        self.last_prediction_time = timestamp\n\n        if len(self.samples) < 5:\n            return self.status()\n\n        sample_times = np.asarray([item[0] for item in self.samples], dtype=np.float64)\n        sample_values = np.asarray([item[1] for item in self.samples], dtype=np.float64)\n\n        if sample_times[-1] - sample_times[0] < self.window_seconds * 0.70:\n            return self.status()\n\n        normalized = normalize_signal(sample_values, self.baseline_median, self.baseline_mad)\n        features = extract_features(sample_times, normalized)\n        probability = self.model.active_probability(features)\n        self.active_probability = probability\n\n        if self.state == "REST":\n            self.rest_candidate_since = None\n\n            if probability >= self.active_threshold:\n                if self.active_candidate_since is None:\n                    self.active_candidate_since = timestamp\n\n                active_confirmed = (\n                    timestamp - self.active_candidate_since\n                    >= self.active_confirm_seconds\n                )\n                outside_refractory = (\n                    timestamp - self.last_rep_completed_at\n                    >= self.refractory_seconds\n                )\n\n                if active_confirmed and outside_refractory:\n                    self.state = "ACTIVE"\n                    self.rep_started_at = timestamp\n                    self.active_candidate_since = None\n            else:\n                self.active_candidate_since = None\n\n        else:\n            self.active_candidate_since = None\n\n            if probability <= self.rest_threshold:\n                if self.rest_candidate_since is None:\n                    self.rest_candidate_since = timestamp\n\n                if (\n                    timestamp - self.rest_candidate_since\n                    >= self.rest_confirm_seconds\n                ):\n                    self._complete_rep_if_valid(timestamp)\n                    self.state = "REST"\n                    self.rep_started_at = None\n                    self.rest_candidate_since = None\n            else:\n                self.rest_candidate_since = None\n\n        return self.status()\n\n    def _complete_rep_if_valid(self, timestamp: float) -> bool:\n        if self.rep_started_at is None:\n            return False\n\n        if timestamp - self.rep_started_at < self.minimum_rep_duration_seconds:\n            return False\n\n        self.rep_count += 1\n        self.last_rep_completed_at = timestamp\n        return True\n\n    def finish_set(self, timestamp: float) -> dict[str, object]:\n        """Finalize a set so the final contraction is not lost."""\n        timestamp = float(timestamp)\n\n        if self.state == "ACTIVE":\n            self._complete_rep_if_valid(timestamp)\n\n        self.state = "REST"\n        self.rep_started_at = None\n        self.active_candidate_since = None\n        self.rest_candidate_since = None\n        return self.status()\n'
TRAINER_CODE = '"""Train the lightweight ActivateMyo bicep-curl rep model.\n\nThe input is one or more manually labelled Excel recordings created by the\nMyoWare collection script. The model learns REST vs ACTIVE from 300 ms\nMyoWare envelope windows.\n\nTraining uses scikit-learn Logistic Regression. The exported model is plain\nJSON, so the live station does not depend on scikit-learn/joblib.\n\nExample:\n    python src/train_rep_count_model.py recording1.xlsx recording2.xlsx \\\n        --model models/bicep_rep_count.json\n"""\n\nfrom __future__ import annotations\n\nimport argparse\nimport json\nimport math\nfrom dataclasses import dataclass\nfrom pathlib import Path\n\nimport numpy as np\nfrom openpyxl import load_workbook\nfrom sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import classification_report, confusion_matrix\nfrom sklearn.model_selection import GroupShuffleSplit, train_test_split\nfrom sklearn.pipeline import Pipeline\nfrom sklearn.preprocessing import StandardScaler\n\n\nWINDOW_SECONDS = 0.30\nSTRIDE_SECONDS = 0.10\nLABEL_PURITY = 0.80\nSECONDS_BEFORE_FIRST_REP = 3.0\nSECONDS_AFTER_LAST_REP = 3.0\n\nFEATURE_NAMES = [\n    "mean",\n    "median",\n    "std",\n    "minimum",\n    "maximum",\n    "range",\n    "p10",\n    "p90",\n    "rms",\n    "slope",\n    "mean_abs_diff",\n    "start_to_end",\n]\n\nSTATE_MACHINE = {\n    "active_threshold": 0.60,\n    "rest_threshold": 0.35,\n    "active_confirm_seconds": 0.10,\n    "rest_confirm_seconds": 0.10,\n    "minimum_rep_duration_seconds": 0.60,\n    "refractory_seconds": 0.35,\n}\n\n\n@dataclass\nclass Recording:\n    path: Path\n    times: np.ndarray\n    raw: np.ndarray\n    labels: np.ndarray\n    manual_reps: int\n    baseline_median: float\n    baseline_mad: float\n\n\ndef _headers(row: tuple[object, ...]) -> dict[str, int]:\n    return {\n        str(value).strip().lower(): index\n        for index, value in enumerate(row)\n        if value is not None\n    }\n\n\ndef load_recording(path: Path) -> Recording:\n    workbook = load_workbook(path, read_only=True, data_only=True)\n\n    if "Raw EMG Data" not in workbook.sheetnames or "Rep Events" not in workbook.sheetnames:\n        raise ValueError(f"{path}: expected \'Raw EMG Data\' and \'Rep Events\' sheets")\n\n    event_rows = workbook["Rep Events"].iter_rows(values_only=True)\n    event_columns = _headers(next(event_rows))\n\n    starts: list[float] = []\n    ends: list[float] = []\n\n    for row in event_rows:\n        event = row[event_columns["event"]]\n        event_time = row[event_columns["time (s)"]]\n\n        if event is None or event_time is None:\n            continue\n\n        name = str(event).strip().upper()\n        if name == "REP_START":\n            starts.append(float(event_time))\n        elif name == "REP_END":\n            ends.append(float(event_time))\n\n    if not starts or not ends:\n        raise ValueError(f"{path}: no manually labelled repetitions found")\n\n    first_rep = min(starts)\n    last_rep = max(ends)\n    crop_start = max(0.0, first_rep - SECONDS_BEFORE_FIRST_REP)\n    crop_end = last_rep + SECONDS_AFTER_LAST_REP\n\n    raw_rows = workbook["Raw EMG Data"].iter_rows(values_only=True)\n    raw_columns = _headers(next(raw_rows))\n\n    times: list[float] = []\n    values: list[float] = []\n    labels: list[int] = []\n\n    for row in raw_rows:\n        timestamp = row[raw_columns["time (s)"]]\n        raw_value = row[raw_columns["raw value"]]\n        active = row[raw_columns["rep active"]]\n\n        if timestamp is None or raw_value is None or active is None:\n            continue\n\n        timestamp = float(timestamp)\n        raw_value = float(raw_value)\n\n        if not math.isfinite(raw_value) or not (crop_start <= timestamp <= crop_end):\n            continue\n\n        times.append(timestamp)\n        values.append(raw_value)\n        labels.append(int(active))\n\n    workbook.close()\n\n    times_array = np.asarray(times, dtype=np.float64)\n    raw_array = np.asarray(values, dtype=np.float64)\n    labels_array = np.asarray(labels, dtype=np.int8)\n\n    baseline_values = raw_array[\n        (times_array >= crop_start)\n        & (times_array < first_rep)\n        & (labels_array == 0)\n    ]\n\n    if baseline_values.size < 10:\n        baseline_values = raw_array[labels_array == 0]\n\n    if baseline_values.size == 0:\n        raise ValueError(f"{path}: no REST samples available for baseline calibration")\n\n    baseline_median = float(np.median(baseline_values))\n    baseline_mad = max(\n        float(np.median(np.abs(baseline_values - baseline_median))),\n        1.0,\n    )\n\n    return Recording(\n        path=path,\n        times=times_array,\n        raw=raw_array,\n        labels=labels_array,\n        manual_reps=len(ends),\n        baseline_median=baseline_median,\n        baseline_mad=baseline_mad,\n    )\n\n\ndef normalize_signal(values: np.ndarray, median: float, mad: float) -> np.ndarray:\n    return (np.asarray(values, dtype=np.float64) - median) / max(mad, 1.0)\n\n\ndef extract_features(times: np.ndarray, values: np.ndarray) -> np.ndarray:\n    relative_time = times - times[0]\n    slope = float(np.polyfit(relative_time, values, 1)[0]) if relative_time[-1] > 0 else 0.0\n    diff = np.diff(values)\n\n    return np.asarray(\n        [\n            np.mean(values),\n            np.median(values),\n            np.std(values),\n            np.min(values),\n            np.max(values),\n            np.ptp(values),\n            np.percentile(values, 10),\n            np.percentile(values, 90),\n            np.sqrt(np.mean(values ** 2)),\n            slope,\n            float(np.mean(np.abs(diff))) if diff.size else 0.0,\n            values[-1] - values[0],\n        ],\n        dtype=np.float64,\n    )\n\n\ndef recording_to_windows(recording: Recording) -> tuple[np.ndarray, np.ndarray]:\n    normalized = normalize_signal(\n        recording.raw,\n        recording.baseline_median,\n        recording.baseline_mad,\n    )\n\n    features: list[np.ndarray] = []\n    labels: list[int] = []\n\n    end = recording.times[0] + WINDOW_SECONDS\n\n    while end <= recording.times[-1]:\n        mask = (\n            (recording.times > end - WINDOW_SECONDS)\n            & (recording.times <= end)\n        )\n\n        if np.count_nonzero(mask) >= 5:\n            active_fraction = float(np.mean(recording.labels[mask]))\n\n            if active_fraction >= LABEL_PURITY:\n                label = 1\n            elif active_fraction <= 1.0 - LABEL_PURITY:\n                label = 0\n            else:\n                end += STRIDE_SECONDS\n                continue\n\n            features.append(\n                extract_features(\n                    recording.times[mask],\n                    normalized[mask],\n                )\n            )\n            labels.append(label)\n\n        end += STRIDE_SECONDS\n\n    if not features:\n        raise ValueError(f"{recording.path}: no valid ML windows generated")\n\n    return np.vstack(features), np.asarray(labels, dtype=np.int8)\n\n\ndef build_model() -> Pipeline:\n    return Pipeline(\n        [\n            ("scaler", StandardScaler()),\n            (\n                "classifier",\n                LogisticRegression(\n                    class_weight="balanced",\n                    max_iter=2000,\n                    random_state=42,\n                ),\n            ),\n        ]\n    )\n\n\ndef train(paths: list[Path], model_path: Path) -> None:\n    recordings: list[Recording] = []\n    feature_sets: list[np.ndarray] = []\n    label_sets: list[np.ndarray] = []\n    group_sets: list[np.ndarray] = []\n\n    print("\\n=== ActivateMyo lightweight rep model ===")\n\n    for group, path in enumerate(paths):\n        recording = load_recording(path)\n        features, labels = recording_to_windows(recording)\n\n        recordings.append(recording)\n        feature_sets.append(features)\n        label_sets.append(labels)\n        group_sets.append(np.full(len(labels), group, dtype=np.int32))\n\n        print(f"\\n{path.name}")\n        print(f"  Manual reps:      {recording.manual_reps}")\n        print(f"  Exercise samples: {len(recording.raw)}")\n        print(f"  Windows:          {len(labels)}")\n        print(f"  REST / ACTIVE:    {int(np.sum(labels == 0))} / {int(np.sum(labels == 1))}")\n        print(f"  Baseline median:  {recording.baseline_median:.2f}")\n        print(f"  Baseline MAD:     {recording.baseline_mad:.2f}")\n\n    features = np.vstack(feature_sets)\n    labels = np.concatenate(label_sets)\n    groups = np.concatenate(group_sets)\n\n    if len(np.unique(labels)) < 2:\n        raise RuntimeError("Training data must contain both REST and ACTIVE windows")\n\n    if len(np.unique(groups)) >= 2:\n        splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)\n        train_index, test_index = next(splitter.split(features, labels, groups))\n        validation_note = "Held-out complete recording(s)"\n    else:\n        train_index, test_index = train_test_split(\n            np.arange(len(labels)),\n            test_size=0.25,\n            random_state=42,\n            stratify=labels,\n        )\n        validation_note = (\n            "Same-recording holdout only. Collect multiple independent sets "\n            "before treating this as a real generalization score."\n        )\n\n    validation_model = build_model()\n    validation_model.fit(features[train_index], labels[train_index])\n    predictions = validation_model.predict(features[test_index])\n\n    print(f"\\nValidation: {validation_note}")\n    print(\n        classification_report(\n            labels[test_index],\n            predictions,\n            target_names=["REST", "ACTIVE"],\n            digits=3,\n        )\n    )\n    print("Confusion matrix [REST, ACTIVE]:")\n    print(confusion_matrix(labels[test_index], predictions))\n\n    final_model = build_model()\n    final_model.fit(features, labels)\n\n    scaler: StandardScaler = final_model.named_steps["scaler"]\n    classifier: LogisticRegression = final_model.named_steps["classifier"]\n\n    payload = {\n        "format": "activatemyo-logreg-v1",\n        "feature_names": FEATURE_NAMES,\n        "window_seconds": WINDOW_SECONDS,\n        "stride_seconds": STRIDE_SECONDS,\n        "scaler_mean": [float(value) for value in scaler.mean_],\n        "scaler_scale": [float(value) for value in scaler.scale_],\n        "coef": [float(value) for value in classifier.coef_[0]],\n        "intercept": float(classifier.intercept_[0]),\n        "state_machine": STATE_MACHINE,\n        "training_info": {\n            "recordings": len(recordings),\n            "manual_reps": sum(recording.manual_reps for recording in recordings),\n            "training_windows": len(labels),\n            "rest_windows": int(np.sum(labels == 0)),\n            "active_windows": int(np.sum(labels == 1)),\n        },\n    }\n\n    model_path.parent.mkdir(parents=True, exist_ok=True)\n    model_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")\n\n    print(f"\\nPortable JSON model saved to: {model_path.resolve()}")\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description=__doc__)\n    parser.add_argument("recordings", nargs="+", help="Manually labelled .xlsx recording(s)")\n    parser.add_argument(\n        "--model",\n        default="models/bicep_rep_count.json",\n        help="Output model JSON path",\n    )\n    args = parser.parse_args()\n\n    paths = [Path(value) for value in args.recordings]\n    missing = [path for path in paths if not path.exists()]\n    if missing:\n        raise SystemExit("Missing file(s):\\n" + "\\n".join(f"  {path}" for path in missing))\n\n    train(paths, Path(args.model))\n\n\nif __name__ == "__main__":\n    main()\n'
MODEL_JSON = '{\n  "format": "activatemyo-logreg-v1",\n  "feature_names": [\n    "mean",\n    "median",\n    "std",\n    "minimum",\n    "maximum",\n    "range",\n    "p10",\n    "p90",\n    "rms",\n    "slope",\n    "mean_abs_diff",\n    "start_to_end"\n  ],\n  "window_seconds": 0.3,\n  "stride_seconds": 0.1,\n  "scaler_mean": [\n    19.009168908116294,\n    19.17645003494059,\n    2.3498464262974355,\n    15.282669461914741,\n    22.720160726764533,\n    7.437491264849761,\n    15.901897274633132,\n    21.811806429070607,\n    20.294835916377444,\n    1.1033004552377936,\n    0.5432409101537259,\n    0.1068134171907754\n  ],\n  "scaler_scale": [\n    14.992703344258794,\n    15.486627359557733,\n    2.590158488888963,\n    15.289869128782652,\n    14.452120253351145,\n    7.480031975578532,\n    15.342805501020283,\n    14.893729305446538,\n    13.655767664188893,\n    41.38764559679671,\n    0.3029112233468302,\n    7.5982247545704755\n  ],\n  "coef": [\n    0.5296838530864211,\n    0.836053139568982,\n    -0.025770762164658095,\n    0.5465254604181506,\n    0.8179163021033917,\n    0.46314267120032365,\n    -0.6044921815154668,\n    0.5340428473007133,\n    -1.1642255102968937,\n    0.16359828978145433,\n    -0.2997589115262105,\n    -0.8076364688312235\n  ],\n  "intercept": 0.11050699448480224,\n  "state_machine": {\n    "active_threshold": 0.6,\n    "rest_threshold": 0.35,\n    "active_confirm_seconds": 0.1,\n    "rest_confirm_seconds": 0.1,\n    "minimum_rep_duration_seconds": 0.6,\n    "refractory_seconds": 0.35\n  },\n  "training_info": {\n    "manual_reps": 5,\n    "exercise_samples": 5746,\n    "training_windows": 318,\n    "rest_windows": 130,\n    "active_windows": 188,\n    "same_recording_validation_accuracy": 0.825\n  }\n}'


def die(message: str) -> None:
    raise SystemExit("\nERROR: " + message + "\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        die(
            f"Could not safely patch {label}. "
            f"Expected exactly 1 matching block, found {count}. "
            "Your station.py may have changed."
        )
    return text.replace(old, new, 1)


def git_output(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if result.returncode != 0:
        die(result.stderr.strip() or "Git command failed")
    return result.stdout.strip()


def main() -> None:
    root = Path.cwd()

    if not (root / ".git").exists():
        die("Run this from the root of your cloned repo, e.g. cd ~/feature4")

    branch = git_output("branch", "--show-current")
    if branch != "feature4":
        die(f"You are on '{branch}'. Switch first: git checkout feature4")

    station_path = root / "EMG/app/src/station.py"
    requirements_path = root / "EMG/app/requirements.in"
    runtime_path = root / "EMG/app/src/ml_rep_counter.py"
    trainer_path = root / "EMG/app/src/train_rep_count_model.py"
    model_path = root / "EMG/app/models/bicep_rep_count.json"

    if not station_path.exists():
        die(f"Could not find {station_path}")

    print("Branch verified: feature4")
    print("Creating ML files...")

    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_path.write_text(RUNTIME_CODE, encoding="utf-8")
    trainer_path.write_text(TRAINER_CODE, encoding="utf-8")
    model_path.write_text(MODEL_JSON, encoding="utf-8")

    station = station_path.read_text(encoding="utf-8")

    if "from ml_rep_counter import LiveRepCounter" in station:
        die("station.py already appears to contain the ML integration.")

    backup_path = station_path.with_name("station.py.before_ml")
    if not backup_path.exists():
        backup_path.write_text(station, encoding="utf-8")

    station = replace_once(
        station,
        "import argparse\nimport json\n",
        "import argparse\nimport json\nfrom collections import deque\nfrom statistics import median\n",
        "imports",
    )

    station = replace_once(
        station,
        "from recorder import PairNormalizer, RepThresholds, SessionRecorder\n"
        "from sources import LibEMGSource, SampleSource, SimulatedSource\n",
        "from recorder import PairNormalizer, RepThresholds, SessionRecorder\n"
        "from sources import LibEMGSource, SampleSource, SimulatedSource\n"
        "from ml_rep_counter import LiveRepCounter\n",
        "ML import",
    )

    station = replace_once(
        station,
        'APP_DIR = Path(__file__).resolve().parents[1]\n'
        'ENV_FILE = APP_DIR / ".env"\n',
        'APP_DIR = Path(__file__).resolve().parents[1]\n'
        'MODEL_PATH = APP_DIR / "models" / "bicep_rep_count.json"\n'
        'ENV_FILE = APP_DIR / ".env"\n',
        "model path",
    )

    station = replace_once(
        station,
        "        self.last_pct: tuple[Optional[float], Optional[float]] = (None, None)\n"
        "        self.changed_at = 0.0  # last local connect/disconnect/start; older replies are stale\n",
        "        self.last_pct: tuple[Optional[float], Optional[float]] = (None, None)\n"
        "        self.rest_left: deque[float] = deque(maxlen=200)\n"
        "        self.ml_counter: Optional[LiveRepCounter] = None\n"
        "        self.changed_at = 0.0  # last local connect/disconnect/start; older replies are stale\n",
        "Station ML state",
    )

    station = replace_once(
        station,
        '                log("Recording discarded (cancelled, disconnected or timed out).")\n'
        "                self.session = None\n",
        '                log("Recording discarded (cancelled, disconnected or timed out).")\n'
        "                self.session = None\n"
        "                self.ml_counter = None\n",
        "discard cleanup",
    )

    marker = "    # ------------------------------------------------------------- commands\n"
    method = (
        "    def start_ml_rep_counter(self, exercise_name: str) -> None:\n"
        "        \"\"\"Enable ML rep counting for Bicep Curl using recent relaxed EMG.\"\"\"\n"
        "\n"
        "        self.ml_counter = None\n"
        "\n"
        "        if exercise_name.strip().lower() != \"bicep curl\":\n"
        "            return\n"
        "\n"
        "        if not MODEL_PATH.exists():\n"
        "            log(f\"ML rep model not found: {MODEL_PATH}; using threshold rep counter.\")\n"
        "            return\n"
        "\n"
        "        rest_values = list(self.rest_left)\n"
        "        if len(rest_values) < 60:\n"
        "            log(\"Not enough relaxed left-bicep data for ML rep counting. \"\n"
        "                \"Relax for several seconds before Start; using threshold counter.\")\n"
        "            return\n"
        "\n"
        "        baseline_median = float(median(rest_values))\n"
        "        baseline_mad = float(median(abs(value - baseline_median) for value in rest_values))\n"
        "        baseline_mad = max(baseline_mad, 1.0)\n"
        "\n"
        "        self.ml_counter = LiveRepCounter(\n"
        "            MODEL_PATH,\n"
        "            baseline_median=baseline_median,\n"
        "            baseline_mad=baseline_mad,\n"
        "        )\n"
        "\n"
        "        log(f\"ML rep counter ready (baseline={baseline_median:.1f}, MAD={baseline_mad:.1f})\")\n"
        "\n"
    )

    station = replace_once(station, marker, method + marker, "ML start method")

    station = replace_once(
        station,
        "                self.changed_at = now\n"
        '            log(f"Recording {self.session.exercise_name} — set 1")\n',
        "                self.start_ml_rep_counter(self.session.exercise_name)\n"
        "                self.changed_at = now\n"
        '            log(f"Recording {self.session.exercise_name} — set 1")\n',
        "start command",
    )

    station = replace_once(
        station,
        "                if s is None or s.session_id != sid:\n"
        "                    return\n"
        "                done = s.next_set(now)\n"
        '            log(f"Set {done.set_number}: {done.reps} reps, {round(done.tut_s)} s under tension")\n',
        "                if s is None or s.session_id != sid:\n"
        "                    return\n"
        "                if self.ml_counter is not None:\n"
        "                    ml = self.ml_counter.finish_set(now)\n"
        '                    s.current.reps = int(ml["rep_count"])\n'
        "                done = s.next_set(now)\n"
        "                if self.ml_counter is not None:\n"
        "                    self.ml_counter.reset()\n"
        '            log(f"Set {done.set_number}: {done.reps} reps, {round(done.tut_s)} s under tension")\n',
        "next-set finalization",
    )

    station = replace_once(
        station,
        "                if s is None or s.session_id != sid:\n"
        "                    return\n"
        "                summary = s.finish(now)\n"
        "                self.session = None\n",
        "                if s is None or s.session_id != sid:\n"
        "                    return\n"
        "                if self.ml_counter is not None:\n"
        "                    ml = self.ml_counter.finish_set(now)\n"
        '                    s.current.reps = int(ml["rep_count"])\n'
        "                summary = s.finish(now)\n"
        "                self.session = None\n"
        "                self.ml_counter = None\n",
        "finish finalization",
    )

    station = replace_once(
        station,
        "                if self.session is not None and self.session.session_id == sid:\n"
        "                    self.session = None\n"
        '                    why = {"user": "cancelled on the phone", "disconnect": "discarded — the user disconnected",\n',
        "                if self.session is not None and self.session.session_id == sid:\n"
        "                    self.session = None\n"
        "                    self.ml_counter = None\n"
        '                    why = {"user": "cancelled on the phone", "disconnect": "discarded — the user disconnected",\n',
        "cancel cleanup",
    )

    old_sample = (
        "                with self.lock:\n"
        "                    self.last_pct = (left, right)\n"
        "                    if self.session is not None:\n"
        "                        self.session.feed(t, left, right)\n"
        "                    if self.connected:\n"
    )

    new_sample = (
        "                with self.lock:\n"
        "                    self.last_pct = (left, right)\n"
        "\n"
        "                    if self.session is None and left_raw is not None:\n"
        "                        self.rest_left.append(float(left_raw))\n"
        "\n"
        "                    if self.session is not None:\n"
        "                        self.session.feed(t, left, right)\n"
        "                        if self.ml_counter is not None and left_raw is not None:\n"
        "                            ml = self.ml_counter.update(t, float(left_raw))\n"
        '                            self.session.current.reps = int(ml["rep_count"])\n'
        "\n"
        "                    if self.connected:\n"
    )

    station = replace_once(station, old_sample, new_sample, "sample loop")

    station_path.write_text(station, encoding="utf-8")

    requirements = requirements_path.read_text(encoding="utf-8") if requirements_path.exists() else ""
    existing = {
        line.strip().lower()
        for line in requirements.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }

    for dependency in ("openpyxl", "scikit-learn"):
        if dependency not in existing:
            if requirements and not requirements.endswith("\n"):
                requirements += "\n"
            requirements += dependency + "\n"

    requirements_path.write_text(requirements, encoding="utf-8")

    for path in (station_path, runtime_path, trainer_path):
        result = subprocess.run(
            [sys.executable, "-m", "py_compile", str(path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            die(f"Compile check failed for {path}:\n{result.stderr}")

    print("\nSUCCESS — Feature 4 ML rep counting installed locally.")
    print("\nChanged:")
    print("  EMG/app/src/station.py")
    print("  EMG/app/src/ml_rep_counter.py")
    print("  EMG/app/src/train_rep_count_model.py")
    print("  EMG/app/models/bicep_rep_count.json")
    print("  EMG/app/requirements.in")
    print("\nBackup:")
    print("  EMG/app/src/station.py.before_ml")
    print("\nNothing was committed, pushed, or merged.")
    print("\nNext:")
    print("  git diff -- EMG/app")
    print("  cd EMG/app")
    print("  python src/station.py")


if __name__ == "__main__":
    main()
