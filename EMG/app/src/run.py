"""Tiny Flask page for checking whether the online BLE streamer starts."""

from html import escape

from flask import Flask

from streamer import _streamer_manager, get_online_handler

app = Flask(__name__)


@app.get("/")
def connect_streamer():
    try:
        get_online_handler()
        if _streamer_manager.process is None or not _streamer_manager.process.is_alive():
            raise RuntimeError("Streamer process did not start")
        return "<h2>Streamer started and is scanning for BLE sensors</h2>", 200
    except Exception as exc:
        return f"<h2>Streamer start failed</h2><p>{escape(str(exc))}</p>", 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
