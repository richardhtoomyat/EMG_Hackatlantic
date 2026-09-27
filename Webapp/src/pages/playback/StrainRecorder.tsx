import { useEffect, useState } from "react";
import BodyMap from "../../components/BodyMap";
import { useAuth } from "../../auth/authContext";
import { uploadRecording } from "./recordingStorage";

type StrainReading = { time_s: number; raw: number; strain_pct: number };
type StrainRecording = {
  channel: string;
  muscle: string;
  baseline: number;
  duration_s: number;
  sample_count: number;
  readings: StrainReading[];
};

export default function StrainRecorder() {
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [data, setData] = useState<StrainRecording | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const current = data?.readings[index];

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!playing || !data) return;
    const intervalMs = Math.max(10, (data.duration_s * 1000) / Math.max(data.readings.length - 1, 1));
    const timer = window.setInterval(() => {
      setIndex((position) => Math.min(position + 1, data.readings.length - 1));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [playing, data]);

  useEffect(() => {
    if (playing && data && index >= data.readings.length - 1) setPlaying(false);
  }, [playing, data, index]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("http://localhost:5000/start_strain", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not start strain recording");
      setData(null);
      setSaved(false);
      setPlaying(false);
      setIndex(0);
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("http://localhost:5000/end_strain", { method: "POST" });
      const result = await response.json();
      setRecording(false);
      if (!response.ok) throw new Error(result.error ?? "Could not stop strain recording");
      setData(result as StrainRecording);
      setIndex(0);
      setRecording(false);
      if (!user) throw new Error("Sign in to save this strain recording");
      await uploadRecording(user.id, 1, result);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface rounded-2xl p-3.5 my-2">
      <div className="text-[11px] tracking-wider text-muted uppercase">Muscle strain playback</div>
      <p className="text-xs text-muted mt-1">Record right chest activity for as long as you like.</p>
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={busy}
        className="w-full h-11 rounded-full bg-accent text-bg text-sm font-semibold mt-3 disabled:opacity-60"
      >
        {busy ? "Please wait..." : recording ? `Stop recording | ${elapsed}s` : "Start strain recording"}
      </button>
      {error && <p role="alert" className="text-xs text-max mt-2">{error}</p>}
      {saved && <p className="text-xs text-accent mt-2">Strain recording saved to Supabase.</p>}
      {data && current && (
        <>
          <div className="bg-[#FAFAFA] rounded-xl p-2 mt-3">
            <BodyMap
              muscles={{}}
              activation={{ "f-pec-r": current.strain_pct }}
              className="w-full h-auto block"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted mt-2">
            <span>{data.muscle} | {current.strain_pct.toFixed(0)}% strain</span>
            <span>{data.sample_count} readings</span>
          </div>
          <p className="text-[11px] text-muted mt-1">Gray is at baseline; red is higher activity.</p>
          <input
            aria-label="Strain playback position"
            type="range"
            min={0}
            max={data.readings.length - 1}
            value={index}
            onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }}
            className="w-full mt-2"
          />
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{current.time_s.toFixed(1)}s / {data.duration_s.toFixed(1)}s</span>
            <button
              type="button"
              onClick={() => {
                if (index >= data.readings.length - 1) setIndex(0);
                setPlaying((value) => !value);
              }}
              className="px-3 py-1 rounded-full border border-line text-ink"
            >
              {playing ? "Pause" : "Play"}
            </button>
          </div>
        </>
      )}
      {data && data.readings.length === 0 && (
        <p className="text-xs text-muted mt-3">No valid right chest readings were captured.</p>
      )}
    </section>
  );
}
