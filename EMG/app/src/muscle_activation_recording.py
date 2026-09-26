"""Record the app's LibEMG stream and summarize a relaxed-muscle baseline."""

from __future__ import annotations

import threading
import time

import numpy as np
from numpy.typing import NDArray
from libemg.data_handler import OnlineDataHandler

from dataclasses import dataclass

try:  # Support both ``python src/script.py`` and package imports.
    from .streamer import load_config
except ImportError:
    from streamer import load_config


SampleBatch = NDArray[np.float64]

@dataclass
class ChannelSummary:
    sample_count: int
    median: float
    mad: float

@dataclass
class RestSummary:
    sample_count: int
    duration_s: float
    channels: dict[str, ChannelSummary]

class MuscleActivationRecording:
    """Collect samples from ``get_online_handler`` while active.

    Pass the ``OnlineDataHandler`` returned by the app's ``get_online_handler``.
    The background collector uses its
    ``get_data`` method and tracks the stream's cumulative sample count so each
    sample is added once.
    """

    def __init__(
        self,
        online_handler: OnlineDataHandler,
        *,
        poll_interval_s: float = 0.01,
    ) -> None:
        if poll_interval_s <= 0:
            raise ValueError("poll_interval_s must be greater than zero")
        self._handler = online_handler
        config = load_config()
        self._channel_names = tuple(config.sensor_names)
        self._missing_value = config.missing_value
        self._poll_interval_s = float(poll_interval_s)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._recording_active = False
        self._recorded_batches: list[SampleBatch] = []
        self._last_recording: SampleBatch | None = None
        self._channel_count: int | None = None
        self._started_at: float | None = None
        self._duration_s = 0.0
        self._collector_error: Exception | None = None
        self._last_stream_count = 0

    @property
    def is_recording(self) -> bool:
        """Whether the background collector is currently running."""
        return self._recording_active

    def start(self) -> None:
        """Begin collecting new samples; starting twice raises ``RuntimeError``."""
        if self._recording_active:
            raise RuntimeError("A recording is already in progress; call stop() first")
        _, counts = self._handler.get_data(N=0, filter=False)
        self._last_stream_count = int(counts.get("emg", 0))
        self._recorded_batches = []
        self._last_recording = None
        self._channel_count = None
        self._collector_error = None
        self._started_at = time.monotonic()
        self._stop_event.clear()
        self._recording_active = True
        self._thread = threading.Thread(
            target=self._collect,
            name="muscle-activation-recording",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> SampleBatch:
        """Stop collection and return a copy shaped ``(samples, channels)``."""
        thread = self._thread
        if thread is None:
            raise RuntimeError("No recording has been started")
        self._stop_event.set()
        thread.join()
        if self._started_at is not None:
            self._duration_s = time.monotonic() - self._started_at
        if self._recorded_batches:
            recording = np.concatenate(self._recorded_batches, axis=0)
        else:
            channels = self._channel_count or len(self._channel_names)
            recording = np.empty((0, channels), dtype=np.float64)
        self._last_recording = recording
        self._thread = None
        self._recording_active = False
        if self._collector_error is not None:
            raise RuntimeError("Sample collection failed") from self._collector_error
        return recording.copy()

    def summarize_rest(self) -> dict[str, object]:
        """Summarize the stopped recording as a per-channel rest baseline.

        ``median`` is the baseline estimate and ``p95`` captures typical
        upper-end rest activity. Invalid/missing values are excluded. The
        result is a plain dictionary suitable for JSON serialization.
        """
        if self._last_recording is None:
            raise RuntimeError("Stop a recording before summarizing rest")
        data = self._last_recording.copy()

        names = self._channel_names or tuple(f"channel_{i}" for i in range(data.shape[1]))
        if len(names) != data.shape[1]:
            raise ValueError(
                f"Received {data.shape[1]} channels but {len(names)} channel names were configured"
            )

        channels: dict[str, dict[str, float | int]] = {}
        for index, name in enumerate(names):
            values = data[:, index]
            valid = values[np.isfinite(values) & (values != self._missing_value)]
            if valid.size == 0:
                channels[name] = {"sample_count": 0}
                continue
            channels[name] = ChannelSummary(
                sample_count=int(valid.size),
                median=float(np.median(valid)),
                mad=float(np.median(np.abs(valid - np.median(valid))))
            )
            
        return RestSummary(
            sample_count=int(data.shape[0]),
            duration_s=float(self._duration_s),
            channels= channels
        )

    def _collect(self) -> None:
        while not self._stop_event.is_set():
            try:
                _, counts = self._handler.get_data(N=0, filter=False)
                stream_count = int(counts.get("emg", 0))
                new_count = stream_count - self._last_stream_count
                if new_count > 0:
                    data, _ = self._handler.get_data(N=new_count, filter=False)
                    batch = np.asarray(data["emg"], dtype=np.float64)
                    if batch.ndim == 1:
                        batch = batch.reshape(1, -1)
                    if batch.ndim != 2:
                        raise ValueError("OnlineDataHandler returned EMG data with an invalid shape")
                    if batch.shape[0] > 0:
                        if self._channel_count is None:
                            self._channel_count = batch.shape[1]
                        elif batch.shape[1] != self._channel_count:
                            raise ValueError("OnlineDataHandler changed channel count during recording")
                        self._recorded_batches.append(batch.copy())
                    self._last_stream_count = stream_count
            except Exception as exc:
                self._collector_error = exc
                self._stop_event.set()
            self._stop_event.wait(self._poll_interval_s)
