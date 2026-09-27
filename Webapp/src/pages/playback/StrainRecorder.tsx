import { useEffect, useState } from "react";
import BodyMap from "../../components/BodyMap";
import { useAuth } from "../../auth/authContext";
import { uploadRecording } from "./recordingStorage";
import { MUSCLE_PLACEMENTS, SENSORS, type SensorChannel, type SensorPlacements } from "./sensorConfig";
import type { MuscleId } from "../../data/types";

type StrainReading = { time_s: number; raw: number; strain_pct: number };
type StrainRecording = {
  channel: string;
  muscle_id: MuscleId;
  baseline: number;
  duration_s: number;
  sample_count: number;
  readings: StrainReading[];
};
type StrainResult = { recordings: StrainRecording[] };
type BaselineChannel = { sample_count: number; median?: number; mad?: number };
type Props = {
  placements: SensorPlacements;
  baselines: Partial<Record<SensorChannel, BaselineChannel>>;
  canStart: boolean;
};

export default function StrainRecorder({ placements, baselines, canStart }: Props) {
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [data, setData] = useState<StrainResult | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const maxIndex = Math.max(0, ...(data?.recordings.map((recording) => recording.readings.length - 1) ?? [0]));
  const duration = Math.max(0, ...(data?.recordings.map((recording) => recording.duration_s) ?? [0]));

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!playing || !data) return;
    const intervalMs = Math.max(10, (duration * 1000) / Math.max(maxIndex, 1));
    const timer = window.setInterval(() => {
      setIndex((position) => Math.min(position + 1, maxIndex));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [playing, data, duration, maxIndex]);

  useEffect(() => {
    if (playing && data && index >= maxIndex) setPlaying(false);
  }, [playing, data, index, maxIndex]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const channels = SENSORS.flatMap((channel) => {
        const muscle_id = placements[channel];
        const baseline = baselines[channel];
        if (muscle_id === null || !baseline) return [];
        return [{ channel, muscle_id, baseline }];
      });
      const response = await fetch("http://localhost:5000/start_strain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      });
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
      setData(result as StrainResult);
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

  const activation: Partial<Record<MuscleId, number>> = {};
  data?.recordings.forEach((recording) => {
    const reading = recording.readings[Math.min(index, recording.readings.length - 1)];
    if (reading) activation[recording.muscle_id] = Math.max(activation[recording.muscle_id] ?? 0, reading.strain_pct);
  });

  return (
    <section className="bg-surface rounded-2xl p-3.5 my-2">
      <div className="text-[11px] tracking-wider text-muted uppercase">Muscle strain playback</div>
      <p className="text-xs text-muted mt-1">Capture strain for each enabled sensor and replay them together.</p>
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={busy || (!recording && !canStart)}
        className="w-full h-11 rounded-full bg-accent text-bg text-sm font-semibold mt-3 disabled:opacity-60"
      >
        {busy ? "Please wait..." : recording ? `Stop recording | ${elapsed}s` : "Start strain recording"}
      </button>
      {error && <p role="alert" className="text-xs text-max mt-2">{error}</p>}
      {saved && <p className="text-xs text-accent mt-2">Strain recording saved to Supabase.</p>}
      {data && data.recordings.length > 0 && (
        <>
          <div className="bg-[#FAFAFA] rounded-xl p-2 mt-3">
            <BodyMap
              muscles={{}}
              activation={activation}
              className="w-full h-auto block"
            />
          </div>
          <div className="text-xs text-muted mt-2">
            {data.recordings.map((recording) => {
              const reading = recording.readings[Math.min(index, recording.readings.length - 1)];
              const placement = MUSCLE_PLACEMENTS.find((item) => item.id === recording.muscle_id)?.label ?? recording.muscle_id;
              return reading ? (
                <p key={recording.channel}>{recording.channel} - {placement}: {reading.strain_pct.toFixed(0)}% ({recording.sample_count} readings)</p>
              ) : <p key={recording.channel}>{recording.channel}: no valid readings</p>;
            })}
          </div>
          <p className="text-[11px] text-muted mt-1">Gray is at baseline; red is higher activity.</p>
          <input
            aria-label="Strain playback position"
            type="range"
            min={0}
            max={maxIndex}
            value={index}
            onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }}
            className="w-full mt-2"
          />
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{(duration * index / Math.max(maxIndex, 1)).toFixed(1)}s / {duration.toFixed(1)}s</span>
            <button
              type="button"
              onClick={() => {
                if (index >= maxIndex) setIndex(0);
                setPlaying((value) => !value);
              }}
              disabled={maxIndex === 0}
              className="px-3 py-1 rounded-full border border-line text-ink"
            >
              {playing ? "Pause" : "Play"}
            </button>
          </div>
        </>
      )}
      {data && data.recordings.every((recording) => recording.readings.length === 0) && (
        <p className="text-xs text-muted mt-3">No valid sensor readings were captured.</p>
      )}
    </section>
  );
}
