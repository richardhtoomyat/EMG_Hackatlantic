"""Small Flask API for passive baseline recording."""

from dataclasses import asdict
from math import isfinite
import threading

from flask import Flask, jsonify, request

from data_access.streamer import OnlineEMGStream, get_online_handler, load_config
from features.muscle_activation_recording import MuscleActivationRecording

app = Flask(__name__)
recording: MuscleActivationRecording | None = None
strain_recording: MuscleActivationRecording | None = None
strain_channels: list[dict] = []
recording_lock = threading.Lock()


@app.after_request
def allow_frontend(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


@app.post("/start_passive")
def start_passive_recording():
    global recording
    with recording_lock:
        if strain_recording is not None and strain_recording.is_recording:
            return jsonify(error="A strain recording is in progress"), 409
        if recording is not None and recording.is_recording:
            return jsonify(error="A passive recording is already in progress"), 409
        try:
            stream = OnlineEMGStream(get_online_handler())
            recording = MuscleActivationRecording(stream)
            recording.start()
            return jsonify(status="recording")
        except Exception as exc:
            recording = None
            return jsonify(error=str(exc)), 500


@app.post("/end_passive")
def stop_passive_recording():
    global recording
    with recording_lock:
        if recording is None or not recording.is_recording:
            return jsonify(error="No passive recording is in progress"), 409
        try:
            recording.stop()
            summary = asdict(recording.summarize_rest())
            return jsonify(summary)
        except Exception as exc:
            return jsonify(error=str(exc)), 500


@app.post("/start_strain")
def start_strain_recording():
    global strain_channels, strain_recording
    with recording_lock:
        if strain_recording is not None and strain_recording.is_recording:
            return jsonify(error="A strain recording is already in progress"), 409
        if recording is not None and recording.is_recording:
            return jsonify(error="A passive baseline recording is in progress"), 409
        try:
            config = load_config()
            payload = request.get_json(silent=True) or {}
            requested = payload.get("channels")
            if not isinstance(requested, list) or not requested:
                return jsonify(error="Select at least one enabled sensor with a saved baseline"), 400
            configured = set(config.sensor_names)
            normalized = []
            for item in requested:
                if not isinstance(item, dict):
                    return jsonify(error="Invalid sensor selection"), 400
                channel = item.get("channel")
                muscle_id = item.get("muscle_id")
                baseline = item.get("baseline")
                if channel not in configured or not isinstance(muscle_id, str) or not muscle_id:
                    return jsonify(error="Selected sensor or muscle placement is not configured"), 400
                if not isinstance(baseline, dict) or not isinstance(baseline.get("median"), (int, float)):
                    return jsonify(error=f"A valid baseline is required for {channel}"), 400
                if any(saved["channel"] == channel for saved in normalized):
                    return jsonify(error=f"Duplicate sensor selection: {channel}"), 400
                normalized.append({
                    "channel": channel,
                    "muscle_id": muscle_id,
                    "median": float(baseline["median"]),
                    "mad": float(baseline.get("mad", 0.0)),
                })
            stream = OnlineEMGStream(get_online_handler())
            strain_recording = MuscleActivationRecording(stream)
            strain_recording.start()
            strain_channels = normalized
            return jsonify(status="recording")
        except Exception as exc:
            strain_recording = None
            return jsonify(error=str(exc)), 500


@app.post("/end_strain")
def end_strain_recording():
    global strain_channels, strain_recording
    with recording_lock:
        if strain_recording is None or not strain_recording.is_recording:
            return jsonify(error="No strain recording is in progress"), 409
        try:
            samples = strain_recording.stop()
            config = load_config()
            duration_s = strain_recording.duration_s
            recordings = []
            for selection in strain_channels:
                channel_name = selection["channel"]
                channel_index = config.sensor_names.index(channel_name)
                baseline_median = selection["median"]
                baseline_mad = selection["mad"]
                rest_threshold = baseline_median + 3 * abs(baseline_mad)
                values = samples[:, channel_index] if samples.size else []
                valid = [
                    (index, float(value))
                    for index, value in enumerate(values)
                    if isfinite(value) and value != config.missing_value
                ]
                # The passive median plus a 3-MAD noise margin is treated as
                # zero. Normalize the remaining envelope to the strongest
                # above-rest sample in this recording (per channel).
                above_rest = [
                    (index, value, max(0.0, value - rest_threshold))
                    for index, value in valid
                ]
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
                recordings.append({
                    "channel": channel_name,
                    "muscle_id": selection["muscle_id"],
                    "baseline": baseline_median,
                    "duration_s": duration_s,
                    "sample_count": len(readings),
                    "readings": readings,
                })
            strain_channels = []
            return jsonify(recordings=recordings)
        except Exception as exc:
            return jsonify(error=str(exc)), 500


if __name__ == "__main__":
    try:
        get_online_handler()  # Start BLE scanning before the UI can begin a recording.
        print("BLE streamer started; scanning for configured sensors", flush=True)
    except Exception as exc:
        print(f"BLE streamer startup failed: {exc}", flush=True)
    app.run(host="127.0.0.1", port=5000)
