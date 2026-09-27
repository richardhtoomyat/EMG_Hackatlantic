import { useEffect, useState } from "react";
import { useAuth } from "../../auth/authContext";
import { uploadRecording } from "./recordingStorage";

type PassiveSummary = {
  sample_count: number;
  duration_s: number;
  channels: Record<string, { sample_count: number; median?: number; mad?: number }>;
};

async function endPassiveRecording(): Promise<PassiveSummary> {
  const response = await fetch("http://localhost:5000/end_passive", { method: "POST" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not stop recording");
  return result as PassiveSummary;
}

export default function PassiveBaselineRecorder() {
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
      const response = await fetch("http://localhost:5000/start_passive", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Recording request failed");
      setSummary(null);
      setSaved(false);
      setSecondsLeft(5);
      setRecording(true);
      window.setTimeout(() => {
        setBusy(true);
        void endPassiveRecording()
          .then(async (result) => {
            setSummary(result);
            if (!user) throw new Error("Sign in to save this baseline");
            await uploadRecording(user.id, 0, result);
            setSaved(true);
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
        disabled={busy || recording}
        className="w-full h-11 rounded-full bg-accent text-bg text-sm font-semibold disabled:opacity-60"
      >
        {busy ? "Please wait..." : recording ? `Recording baseline (${secondsLeft})...` : "Start recording baseline"}
      </button>
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

