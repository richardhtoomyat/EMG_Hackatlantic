"""Small Flask API for passive baseline recording."""

from dataclasses import asdict
from math import isfinite
import threading

from flask import Flask, jsonify

from data_access.streamer import OnlineEMGStream, get_online_handler, load_config
from features.muscle_activation_recording import MuscleActivationRecording

app = Flask(__name__)
recording: MuscleActivationRecording | None = None
strain_recording: MuscleActivationRecording | None = None
baseline_summary: dict | None = None
recording_lock = threading.Lock()


@app.after_request
def allow_frontend(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


@app.post("/start_passive")
def start_passive_recording():
    global baseline_summary, recording
    with recording_lock:
        if strain_recording is not None and strain_recording.is_recording:
            return jsonify(error="A strain recording is in progress"), 409
        if recording is not None and recording.is_recording:
            return jsonify(error="A passive recording is already in progress"), 409
        try:
            stream = OnlineEMGStream(get_online_handler())
            recording = MuscleActivationRecording(stream)
            recording.start()
            baseline_summary = None
            return jsonify(status="recording")
        except Exception as exc:
            recording = None
            return jsonify(error=str(exc)), 500


@app.post("/end_passive")
def stop_passive_recording():
    global baseline_summary, recording
    with recording_lock:
        if recording is None or not recording.is_recording:
            return jsonify(error="No passive recording is in progress"), 409
        try:
            recording.stop()
            baseline_summary = asdict(recording.summarize_rest())
            return jsonify(baseline_summary)
        except Exception as exc:
            return jsonify(error=str(exc)), 500


@app.post("/start_strain")
def start_strain_recording():
    global strain_recording
    with recording_lock:
        if baseline_summary is None:
            return jsonify(error="Record a passive baseline first"), 409
        if strain_recording is not None and strain_recording.is_recording:
            return jsonify(error="A strain recording is already in progress"), 409
        if recording is not None and recording.is_recording:
            return jsonify(error="A passive baseline recording is in progress"), 409
        try:
            stream = OnlineEMGStream(get_online_handler())
            strain_recording = MuscleActivationRecording(stream)
            strain_recording.start()
            return jsonify(status="recording")
        except Exception as exc:
            strain_recording = None
            return jsonify(error=str(exc)), 500


@app.post("/end_strain")
def end_strain_recording():
    global strain_recording
    with recording_lock:
        if strain_recording is None or not strain_recording.is_recording:
            return jsonify(error="No strain recording is in progress"), 409
        try:
            samples = strain_recording.stop()
            config = load_config()
            channel_name = next(
                (name for name in config.sensor_names if name.lower().endswith("r")),
                config.sensor_names[0],
            )
            baseline = baseline_summary["channels"].get(channel_name) if baseline_summary else None
            if not baseline or not isinstance(baseline.get("median"), (int, float)):
                return jsonify(error=f"No valid baseline is available for {channel_name}"), 409

            channel_index = config.sensor_names.index(channel_name)
            baseline_median = float(baseline["median"])
            baseline_mad = float(baseline.get("mad", 0.0))
            scale = max(abs(baseline_median), 3 * abs(baseline_mad), 1e-6)
            values = samples[:, channel_index] if samples.size else []
            valid = [
                (index, float(value))
                for index, value in enumerate(values)
                if isfinite(value) and value != config.missing_value
            ]
            duration_s = strain_recording.duration_s
            denominator = max(len(values) - 1, 1)
            readings = [
                {
                    "time_s": duration_s * index / denominator,
                    "raw": value,
                    "strain_pct": round(max(0.0, min(100.0, (value - baseline_median) / scale * 100)), 1),
                }
                for index, value in valid
            ]
            return jsonify(
                channel=channel_name,
                muscle="Right chest",
                baseline=baseline_median,
                duration_s=duration_s,
                sample_count=len(readings),
                readings=readings,
            )
        except Exception as exc:
            return jsonify(error=str(exc)), 500


if __name__ == "__main__":
    try:
        get_online_handler()  # Start BLE scanning before the UI can begin a recording.
        print("BLE streamer started; scanning for configured sensors", flush=True)
    except Exception as exc:
        print(f"BLE streamer startup failed: {exc}", flush=True)
    app.run(host="127.0.0.1", port=5000)
