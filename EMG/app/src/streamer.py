"""BLE streamer for MyoWare 2.0 Wireless Shields and LibEMG.

The stock shield firmware sends envelope readings as UTF-8 text notifications.
The first configured sensor drives the output sample cadence; other configured
sensors contribute their latest reading when it is still fresh.
"""

import atexit
import asyncio
import multiprocessing as mp
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
import time
from typing import Any

import numpy as np
from numpy.typing import NDArray
import yaml
from bleak import BleakClient, BleakScanner
from bleak.backends.characteristic import BleakGATTCharacteristic
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from libemg.data_handler import OnlineDataHandler
from libemg.shared_memory_manager import SharedMemoryManager


BUFFER_LENGTH: int = 2000


@dataclass(frozen=True)
class StreamerConfig:
    sensor_names: tuple[str, ...]
    characteristic_uuid: str
    missing_value: float
    channel_stale_after_s: float
    reconnect_delay_s: float

    @property
    def num_channels(self) -> int:
        return len(self.sensor_names)


def load_config(path: Path | None = None) -> StreamerConfig:
    """Read and validate BLE settings when the streamer is started."""
    config_path = path or Path(__file__).resolve().parents[1] / "config.yml"
    with config_path.open("r", encoding="utf-8") as config_file:
        raw: dict[str, Any] = yaml.safe_load(config_file) or {}

    try:
        ble: dict[str, Any] = raw["ble"]
        names = tuple(ble["sensor_names"])
        config = StreamerConfig(
            sensor_names=names,
            characteristic_uuid=str(ble["characteristic_uuid"]),
            missing_value=float(ble["missing_value"]),
            channel_stale_after_s=float(ble["channel_stale_after_ms"]) / 1000.0,
            reconnect_delay_s=float(ble["reconnect_delay_s"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Invalid BLE configuration in {config_path}: {exc}") from exc

    if not config.sensor_names or any(not isinstance(name, str) or not name.strip() for name in config.sensor_names):
        raise ValueError("Configure at least one non-empty BLE sensor name in app/config.yml")
    if len(set(config.sensor_names)) != config.num_channels:
        raise ValueError("BLE sensor names in app/config.yml must be unique")
    if config.channel_stale_after_s < 0 or config.reconnect_delay_s < 0:
        raise ValueError("BLE timing values must be non-negative")
    return config


def _append_sample(smm: SharedMemoryManager, sample: Sequence[float], num_channels: int) -> None:
    """Append one sample row to LibEMG shared memory."""
    if len(sample) != num_channels:
        raise ValueError(f"Expected {num_channels} channels, received {len(sample)}")

    row: NDArray[np.float64] = np.asarray(sample, dtype=np.float64).reshape(1, num_channels)

    def shift_buffer(buffer: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.concatenate((buffer[1:, :], row), axis=0)

    def increment_count(count: NDArray[np.int32]) -> NDArray[np.int32]:
        return count + np.int32(1)

    smm.modify_variable("emg", shift_buffer)
    smm.modify_variable("emg_count", increment_count)


async def _run_ble_streamer(smm: SharedMemoryManager, config: StreamerConfig) -> None:
    sensor_slots: dict[str, int] = {name: index for index, name in enumerate(config.sensor_names)}
    latest_values: list[float] = [config.missing_value] * config.num_channels
    latest_times: list[float] = [0.0] * config.num_channels
    primary_sensor: str | None = None

    # Keep scanning while connected so a later sensor can join automatically.
    connecting: set[str] = set()
    connection_tasks: set[asyncio.Task[None]] = set()

    def on_advertisement(device: BLEDevice, advertisement: AdvertisementData) -> None:
        name: str = advertisement.local_name or device.name or ""
        if name in sensor_slots:
            try_connect_unconnected(name, device)

    def make_notification_callback(
        name: str,
    ) -> Callable[[BleakGATTCharacteristic, bytearray], None]:
        channel: int = sensor_slots[name]

        def on_notification(
            _characteristic: BleakGATTCharacteristic,
            data: bytearray,
        ) -> None:
            nonlocal primary_sensor
            text: str = bytes(data).decode("utf-8", errors="replace").strip("\x00\r\n \t")
            if not text:
                return
            try:
                value: float = float(text)
            except ValueError:
                return
            if not np.isfinite(value):
                return

            now: float = time.monotonic()
            latest_values[channel] = value
            latest_times[channel] = now

            # Let whichever configured sensor starts streaming first drive
            # output rows, so either sensor works when used by itself.
            if primary_sensor is None:
                primary_sensor = name

            # One output row per primary notification avoids duplicate rows
            # when notifications from two sensors interleave.
            if name == primary_sensor:
                row: list[float] = [
                    latest_values[index]
                    if latest_times[index] > 0.0
                    and now - latest_times[index] <= config.channel_stale_after_s
                    else config.missing_value
                    for index in range(config.num_channels)
                ]
                _append_sample(smm, row, config.num_channels)

        return on_notification

    async def connect_and_stream(device: BLEDevice, name: str) -> None:
        nonlocal primary_sensor
        print(f"[BLE] Connecting to {name} ({device.address})", flush=True)
        try:
            async with BleakClient(device) as client:
                await client.start_notify(
                    config.characteristic_uuid,
                    make_notification_callback(name),
                )
                print(f"[BLE] Notifications enabled for {name}", flush=True)
                while client.is_connected:
                    await asyncio.sleep(0.5)
                print(f"[BLE] {name} disconnected", flush=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[BLE] {name} connection failed: {exc}", flush=True)
        finally:
            # Allow the peripheral to resume advertising before retrying.
            if primary_sensor == name:
                primary_sensor = None
            if not asyncio.current_task().cancelling():
                await asyncio.sleep(config.reconnect_delay_s)
            connecting.discard(name)

    def try_connect_unconnected(sensor: str, device: BLEDevice) -> None:
        """Connect a configured sensor when an advertisement appears."""
        if sensor not in sensor_slots or sensor in connecting:
            return

        connecting.add(sensor)
        task: asyncio.Task[None] = asyncio.create_task(connect_and_stream(device, sensor))
        connection_tasks.add(task)
        task.add_done_callback(connection_tasks.discard)

    async with BleakScanner(detection_callback=on_advertisement):
        print(
            f"[BLE] Scanning for {', '.join(config.sensor_names)}; "
            f"characteristic {config.characteristic_uuid}",
            flush=True,
        )
        try:
            await asyncio.Event().wait()
        finally:
            for task in connection_tasks:
                task.cancel()
            if connection_tasks:
                await asyncio.gather(*connection_tasks, return_exceptions=True)


def _ble_streamer_worker(shared_memory_items: list[list[Any]], config: StreamerConfig) -> None:
    """Own the BLE connections and append readings to LibEMG memory."""
    smm = SharedMemoryManager()
    for item in shared_memory_items:
        smm.create_variable(*item)
    asyncio.run(_run_ble_streamer(smm, config))


class StreamerManager:
    """Own the LibEMG handler and the process that fills its shared memory."""

    def __init__(self) -> None:
        self.process: mp.Process | None = None
        self.handler: OnlineDataHandler | None = None
        self.config: StreamerConfig | None = None

    def get_online_handler(self, channel_mask: Sequence[int] | None = None) -> OnlineDataHandler:
        config = self.config or load_config()
        normalized_mask = self._validate_channel_mask(channel_mask, config.num_channels)
        if self.handler is None:
            shared_memory_items: list[list[Any]] = [
                ["emg", (BUFFER_LENGTH, config.num_channels), np.double, mp.Lock()],
                ["emg_count", (1, 1), np.int32, mp.Lock()],
            ]
            self.process = mp.Process(
                target=_ble_streamer_worker,
                args=(shared_memory_items, config),
                daemon=True,
                name="myoware-ble-streamer",
            )
            self.process.start()
            self.handler = OnlineDataHandler(
                shared_memory_items=shared_memory_items,
                channel_mask=normalized_mask,
            )
            self.config = config
        elif normalized_mask is not None:
            self.handler.install_channel_mask(normalized_mask)
        return self.handler

    @staticmethod
    def _validate_channel_mask(mask: Sequence[int] | None, num_channels: int) -> list[int] | None:
        if mask is None:
            return None
        normalized = list(mask)
        if (not normalized or any(type(ch) is not int or ch < 0 or ch >= num_channels for ch in normalized)
                or len(set(normalized)) != len(normalized)):
            raise ValueError(f"channel_mask must contain unique indices from 0 to {num_channels - 1}")
        return normalized

    def cleanup(self) -> None:
        if self.process is not None and self.process.is_alive():
            self.process.terminate()
            self.process.join(timeout=2)


_streamer_manager = StreamerManager()
atexit.register(_streamer_manager.cleanup)


def get_online_handler(channel_mask: Sequence[int] | None = None) -> OnlineDataHandler:
    """Start the BLE streamer and return a LibEMG online data handler."""
    return _streamer_manager.get_online_handler(channel_mask)


if __name__ == "__main__":
    mp.freeze_support()
    online_handler: OnlineDataHandler = get_online_handler()
    print("[LibEMG] Analyzing BLE hardware stream...")
    online_handler.analyze_hardware()
    online_handler.visualize(num_samples=500)
