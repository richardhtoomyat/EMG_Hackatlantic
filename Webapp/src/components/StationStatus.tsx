import { Link } from "react-router-dom";
import type { StationInfo } from "../lib/stationApi";

const dot = (on?: boolean) => `w-2 h-2 rounded-full ${on ? "bg-accent" : "bg-muted"}`;

/** Today header: the real station connection (tap → Workout). */
export function StationStatusPill({ station }: { station: StationInfo | null | undefined }) {
  const base = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface text-xs shrink-0";
  if (station === undefined) {
    return <span className={`${base} text-muted`} data-testid="station-status">…</span>;
  }
  if (station === null) {
    return (
      <Link to="/workout" className={base} data-testid="station-status">
        <span className={dot(false)} /> Not connected
      </Link>
    );
  }
  if (!station.online) {
    return (
      <Link to="/workout" className={base} data-testid="station-status">
        <span className="w-2 h-2 rounded-full bg-max" /> {station.name} offline
      </Link>
    );
  }
  return (
    <Link to="/workout" className={base} data-testid="station-status">
      <span className={dot(true)} /> {station.name}
      <span className="inline-flex items-center gap-1 text-muted">
        · L <span className={dot(station.sensors.left)} /> R <span className={dot(station.sensors.right)} />
      </span>
    </Link>
  );
}

/** Profile → Connected Devices: the station and which sensors are sending. */
export function StationDeviceCard({ station }: { station: StationInfo | null | undefined }) {
  if (station === undefined) {
    return <div className="bg-surface rounded-2xl p-3.5 text-sm text-muted" data-testid="station-device">Checking…</div>;
  }
  if (station === null) {
    return (
      <div className="bg-surface rounded-2xl p-3.5 flex justify-between items-center gap-3" data-testid="station-device">
        <div>
          <div className="font-medium">Not connected</div>
          <div className="text-xs text-muted">Scan a station's QR code from the Workout tab to use its sensors.</div>
        </div>
        <Link to="/workout" className="text-sm text-accent shrink-0">Connect</Link>
      </div>
    );
  }
  const sensor = (label: string, on?: boolean) => (
    <div className="flex items-center gap-2 text-sm">
      <span className={dot(station.online && on)} /> {label}
      <span className="text-xs text-muted">{station.online ? (on ? "sending" : "no signal") : "—"}</span>
    </div>
  );
  return (
    <div className="bg-surface rounded-2xl p-3.5" data-testid="station-device">
      <div className="flex justify-between items-center">
        <div>
          <div className="font-medium">{station.name}</div>
          <div className="text-xs text-muted">
            {station.online ? "Online" : "Offline — is station.py running?"}
            {station.connected_at ? ` · connected since ${new Date(station.connected_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
          </div>
        </div>
        <Link to="/workout" className="text-sm text-accent">Open</Link>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {sensor("Left sensor", station.sensors.left)}
        {sensor("Right sensor", station.sensors.right)}
      </div>
    </div>
  );
}
