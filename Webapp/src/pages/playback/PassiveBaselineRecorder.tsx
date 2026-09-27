import { useEffect, useState } from "react";
import { useAuth } from "../../auth/authContext";
import { uploadRecording } from "./recordingStorage";
import type { PassiveSummary, RecorderTransport } from "./recorderTransport";
import { SENSORS, type SensorPlacements } from "./sensorConfig";

type SavedBaseline = PassiveSummary & { placements: SensorPlacements };

type Props = { placements: SensorPlacements; onSaved: () => Promise<void>; transport: RecorderTransport };

export default function PassiveBaselineRecorder({ placements, onSaved, transport }: Props) {
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [summary, setSummary] = useState<PassiveSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const toggleRecording = async () => {
    setBusy(true);
    setError(null);
    try {
      await transport.startBaseline(placements);
      setSummary(null);
      setSaved(false);
      setSecondsLeft(5);
      setRecording(true);
      window.setTimeout(() => {
        setBusy(true);
        void transport.stopBaseline()
          .then(async ({ summary: result, saved: alreadySaved }) => {
            setSummary(result);
            if (!alreadySaved) {
              if (!user) throw new Error("Sign in to save this baseline");
              const baseline: SavedBaseline = { ...result, placements };
              await uploadRecording(user.id, 0, baseline);
            }
            setSaved(true);
            await onSaved();
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => {
            setRecording(false);
            setBusy(false);
          });
      }, 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface rounded-2xl p-3.5 my-2">
      <button
        type="button"
        onClick={toggleRecording}
        disabled={busy || recording || !SENSORS.some((channel) => placements[channel] !== null)}
        className="w-full h-11 rounded-full bg-accent text-bg text-sm font-semibold disabled:opacity-60"
      >
        {busy ? "Please wait..." : recording ? `Recording baseline (${secondsLeft})...` : "Start recording baseline"}
      </button>
      {!SENSORS.some((channel) => placements[channel] !== null) && (
        <p className="text-xs text-muted mt-2">Choose a placement for at least one sensor to record its baseline.</p>
      )}
      {recording && <p className="text-xs text-muted mt-2">{secondsLeft} seconds remaining</p>}
      {error && <p role="alert" className="text-xs text-max mt-2">{error}</p>}
      {saved && <p className="text-xs text-accent mt-2">Baseline saved to Supabase.</p>}
      {summary && (
        <div className="text-xs text-muted mt-3">
          <p>{summary.sample_count} samples over {summary.duration_s.toFixed(1)} seconds</p>
          {Object.entries(summary.channels).map(([name, stats]) => (
            <p key={name}>
              {name}: {stats.sample_count} samples
              {stats.median !== undefined && ` | median ${stats.median.toFixed(2)} | MAD ${stats.mad?.toFixed(2)}`}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

