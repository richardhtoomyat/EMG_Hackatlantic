"""Serial streamer for the ESP32 Thing Plus base station.

The base station emits one comma-separated two-channel sample per line. This
module adapts that serial stream to LibEMG's shared-memory streamer interface.
"""

import atexit
import multiprocessing as mp
from pathlib import Path
import time

import numpy as np
import serial
import yaml
from libemg.data_handler import OnlineDataHandler
from libemg.shared_memory_manager import SharedMemoryManager


APP_DIR = Path(__file__).resolve().parents[1]
with (APP_DIR / "config.yml").open("r", encoding="utf-8") as config_file:
    CONFIG = yaml.safe_load(config_file)

SERIAL_PORT = CONFIG["serial"]["port"]
BAUD_RATE = int(CONFIG["serial"]["baud_rate"])
MISSING_VALUE = int(CONFIG["serial"]["missing_value"])
NUM_CHANNELS = int(CONFIG["serial"]["max_channel"])

BUFFER_LENGTH = 2000
ADC_CENTER_VALUE = 2048

def _serial_streamer_worker(serial_port, baud_rate, shared_memory_items):
    """Read serial rows and append samples to LibEMG shared memory."""
    smm = SharedMemoryManager()
    for item in shared_memory_items:
        smm.create_variable(*item)

    try:
        with serial.Serial(serial_port, baud_rate, timeout=1) as port:
            port.reset_input_buffer()
            print(f"[Streamer] Connected to Thing Plus on {serial_port}", flush=True)

            while True:
                raw_line = port.readline()
                if not raw_line:
                    continue

                try:
                    fields = raw_line.decode("utf-8", errors="strict").strip().split(",")
                    if len(fields) != NUM_CHANNELS:
                        continue  # Ignore firmware startup/status messages.
                    sample = np.asarray([int(value) for value in fields], dtype=np.double)
                except (UnicodeDecodeError, ValueError):
                    continue

                # The firmware uses -1 for an inactive channel. Keep a stable
                # two-channel array for LibEMG and represent that channel at
                # the ADC's resting midpoint instead of injecting -1 as EMG.
                if np.any(sample == MISSING_VALUE):
                    sample[sample == MISSING_VALUE] = ADC_CENTER_VALUE
                if np.any((sample < 0) | (sample > 4095)):
                    continue

                smm.modify_variable(
                    "emg",
                    lambda buffer, row=sample.copy(): np.concatenate(
                        (buffer[1:, :], row.reshape(1, NUM_CHANNELS)), axis=0
                    ),
                )
                smm.modify_variable("emg_count", lambda count: count + 1)
    except serial.SerialException as exc:
        print(f"[Streamer Error] Could not read {serial_port}: {exc}", flush=True)


_streamer_process = None
_online_handler = None
_shared_memory_items = None


def _cleanup_streamer():
    global _streamer_process
    if _streamer_process is not None and _streamer_process.is_alive():
        _streamer_process.terminate()
        _streamer_process.join(timeout=2)


def get_online_handler(channel_mask=None):
    """Start the serial streamer once and return a LibEMG data handler.

    ``channel_mask`` may be ``[0]``, ``[1]``, or ``[0, 1]``. Use the channel
    indices corresponding to the active sensor(s) when training/classifying.
    """
    global _streamer_process, _online_handler, _shared_memory_items

    if _online_handler is None:
        _shared_memory_items = [
            ["emg", (BUFFER_LENGTH, NUM_CHANNELS), np.double, mp.Lock()],
            ["emg_count", (1, 1), np.int32, mp.Lock()],
        ]
        _streamer_process = mp.Process(
            target=_serial_streamer_worker,
            args=(SERIAL_PORT, BAUD_RATE, _shared_memory_items),
            daemon=True,
            name="thing-plus-serial-streamer",
        )
        _streamer_process.start()

        # LibEMG's handler attaches to the variables created by the streamer.
        _online_handler = OnlineDataHandler(
            shared_memory_items=_shared_memory_items,
            channel_mask=channel_mask,
        )
        atexit.register(_cleanup_streamer)
    elif channel_mask is not None:
        _online_handler.install_channel_mask(channel_mask)

    return _online_handler


if __name__ == "__main__":
    mp.freeze_support()
    odh = get_online_handler()
    print("[LibEMG] Analyzing hardware stream...")
    odh.analyze_hardware()
    odh.visualize(num_samples=500)
