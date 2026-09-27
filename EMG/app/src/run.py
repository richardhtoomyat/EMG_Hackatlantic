"""Small Flask API for passive baseline recording."""

from dataclasses import asdict
import threading

from flask import Flask, jsonify

from data_access.streamer import OnlineEMGStream, get_online_handler
from features.muscle_activation_recording import MuscleActivationRecording

app = Flask(__name__)
recording: MuscleActivationRecording | None = None
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
            return jsonify(asdict(recording.summarize_rest()))
        except Exception as exc:
            return jsonify(error=str(exc)), 500


if __name__ == "__main__":
    try:
        get_online_handler()  # Start BLE scanning before the UI can begin a recording.
        print("BLE streamer started; scanning for configured sensors", flush=True)
    except Exception as exc:
        print(f"BLE streamer startup failed: {exc}", flush=True)
    app.run(host="127.0.0.1", port=5000)
