"""BLE streamer for MyoWare 2.0 Wireless Shields and LibEMG.

The stock shield firmware sends envelope readings as UTF-8 text notifications.
The first configured sensor drives the output sample cadence; other configured
sensors contribute their latest reading when it is still fresh.
"""

import atexit
import asyncio
import multiprocessing as mp
from collections.abc import Callable, Sequence
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


APP_DIR: Path = Path(__file__).resolve().parents[1]
with (APP_DIR / "config.yml").open("r", encoding="utf-8") as config_file:
    CONFIG: dict[str, Any] = yaml.safe_load(config_file)

BLE_CONFIG: dict[str, Any] = CONFIG["ble"]
SENSOR_NAMES: list[str] = BLE_CONFIG["sensor_names"]
CHARACTERISTIC_UUID: str = BLE_CONFIG["characteristic_uuid"]
MISSING_VALUE: float = float(BLE_CONFIG["missing_value"])
CHANNEL_STALE_AFTER_S: float = float(BLE_CONFIG["channel_stale_after_ms"]) / 1000.0
RECONNECT_DELAY_S: float = float(BLE_CONFIG["reconnect_delay_s"])
NUM_CHANNELS: int = len(SENSOR_NAMES)
BUFFER_LENGTH: int = 2000

if not SENSOR_NAMES:
    raise ValueError("Configure at least one BLE sensor name in app/config.yml")
if len(set(SENSOR_NAMES)) != NUM_CHANNELS:
    raise ValueError("BLE sensor names in app/config.yml must be unique")


def _append_sample(smm: SharedMemoryManager, sample: Sequence[float]) -> None:
    """Append one sample row to LibEMG shared memory."""
    if len(sample) != NUM_CHANNELS:
        raise ValueError(f"Expected {NUM_CHANNELS} channels, received {len(sample)}")

    row: NDArray[np.float64] = np.asarray(sample, dtype=np.float64).reshape(1, NUM_CHANNELS)

    def shift_buffer(buffer: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.concatenate((buffer[1:, :], row), axis=0)

    def increment_count(count: NDArray[np.int32]) -> NDArray[np.int32]:
        return count + np.int32(1)

    smm.modify_variable("emg", shift_buffer)
    smm.modify_variable("emg_count", increment_count)


async def _run_ble_streamer(smm: SharedMemoryManager) -> None:
    sensor_slots: dict[str, int] = {name: index for index, name in enumerate(SENSOR_NAMES)}
    latest_values: list[float] = [MISSING_VALUE] * NUM_CHANNELS
    latest_times: list[float] = [0.0] * NUM_CHANNELS
    primary_sensor: str | None = None

    # Keep scanning while connected so a later sensor can join automatically.
    discovery_queue: asyncio.Queue[tuple[BLEDevice, str]] = asyncio.Queue()
    connecting: set[str] = set()
    connection_tasks: set[asyncio.Task[None]] = set()

    def on_advertisement(device: BLEDevice, advertisement: AdvertisementData) -> None:
        name: str = advertisement.local_name or device.name or ""
        if name in sensor_slots and name not in connecting:
            connecting.add(name)
            discovery_queue.put_nowait((device, name))

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
                    and now - latest_times[index] <= CHANNEL_STALE_AFTER_S
                    else MISSING_VALUE
                    for index in range(NUM_CHANNELS)
                ]
                _append_sample(smm, row)

        return on_notification

    async def connect_and_stream(device: BLEDevice, name: str) -> None:
        nonlocal primary_sensor
        print(f"[BLE] Connecting to {name} ({device.address})", flush=True)
        try:
            async with BleakClient(device) as client:
                await client.start_notify(
                    CHARACTERISTIC_UUID,
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
            await asyncio.sleep(RECONNECT_DELAY_S)
            connecting.discard(name)

    async with BleakScanner(detection_callback=on_advertisement):
        print(
            f"[BLE] Scanning for {', '.join(SENSOR_NAMES)}; "
            f"characteristic {CHARACTERISTIC_UUID}",
            flush=True,
        )
        while True:
            device, name = await discovery_queue.get()
            task: asyncio.Task[None] = asyncio.create_task(connect_and_stream(device, name))
            connection_tasks.add(task)
            task.add_done_callback(connection_tasks.discard)


def _ble_streamer_worker(shared_memory_items: list[list[Any]]) -> None:
    """Own the BLE connections and append readings to LibEMG memory."""
    smm = SharedMemoryManager()
    for item in shared_memory_items:
        smm.create_variable(*item)
    asyncio.run(_run_ble_streamer(smm))


_streamer_process: mp.Process | None = None
_online_handler: OnlineDataHandler | None = None
_shared_memory_items: list[list[Any]] | None = None


def _cleanup_streamer() -> None:
    if _streamer_process is not None and _streamer_process.is_alive():
        _streamer_process.terminate()
        _streamer_process.join(timeout=2)


def get_online_handler(
    channel_mask: Sequence[int] | None = None,
) -> OnlineDataHandler:
    """Start the BLE streamer and return a LibEMG online data handler.

    Configure sensor names in ``app/config.yml`` in column order. Add
    ``MyoWareSensorR`` after ``MyoWareSensorL`` when the second shield is ready.
    """
    global _streamer_process, _online_handler, _shared_memory_items

    # ensure valid channel mask
    normalized_mask: list[int] | None = None
    if channel_mask is not None:
        normalized_mask = list(channel_mask)
        if (
            not normalized_mask
            or any(type(channel) is not int or channel < 0 or channel >= NUM_CHANNELS
                   for channel in normalized_mask)
            or len(set(normalized_mask)) != len(normalized_mask)
        ):
            raise ValueError(f"channel_mask must contain unique indices from 0 to {NUM_CHANNELS - 1}")

    if _online_handler is None:
        _shared_memory_items = [
            ["emg", (BUFFER_LENGTH, NUM_CHANNELS), np.double, mp.Lock()],
            ["emg_count", (1, 1), np.int32, mp.Lock()],
        ]
        _streamer_process = mp.Process(
            target=_ble_streamer_worker,
            args=(_shared_memory_items,),
            daemon=True,
            name="myoware-ble-streamer",
        )
        _streamer_process.start()

        _online_handler = OnlineDataHandler(
            shared_memory_items=_shared_memory_items,
            channel_mask=normalized_mask,
        )
        atexit.register(_cleanup_streamer)
    elif normalized_mask is not None:
        _online_handler.install_channel_mask(normalized_mask)

    return _online_handler


if __name__ == "__main__":
    mp.freeze_support()
    online_handler: OnlineDataHandler = get_online_handler()
    print("[LibEMG] Analyzing BLE hardware stream...")
    online_handler.analyze_hardware()
    online_handler.visualize(num_samples=500)
