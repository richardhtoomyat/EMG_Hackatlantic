import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BodyMap from "../components/BodyMap";
import Legend from "../components/Legend";
import ScoreCard from "../components/ScoreCard";
import StatGrid from "../components/StatGrid";
import WeekBars from "../components/WeekBars";
import { MuscleStatList } from "../components/StatGrid";
import BodyMetricReminder from "../components/BodyMetricReminder";
import { useAuth } from "../auth/authContext";
import { useAppData } from "../data/dataContext";
import { mergeExercises } from "../lib/muscleMap";
import { supabase } from "../lib/supabase";

export default function Today() {
  const { ATHLETE, READINESS, SESSION_HISTORY, TODAY_METRICS, WEEKLY_READINESS_TREND_PCT, WEEK_SUMMARY } =
    useAppData();
  const workoutsThisWeek = WEEK_SUMMARY.filter((d) => d.trained).length;
  const todayDate = WEEK_SUMMARY.find((d) => d.isToday)?.date;
  const firstName = ATHLETE.name.split(" ")[0];

  // "Today" body map = union of every exercise logged today.
  const todaysExercises = SESSION_HISTORY.filter((s) => s.date === todayDate).map((s) => s.exerciseName);
  const todayMuscles = mergeExercises(
    todaysExercises.length > 0 ? todaysExercises : ["Bicep Curl", "Squat", "Shoulder Press"]
  );

  return (
    <div className="flex-grow flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-[11px] tracking-wider text-muted uppercase">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </div>
          <h1 className="font-serif font-light text-[27px] leading-tight">Good morning, {firstName}</h1>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface text-xs">
          <span className={`w-2 h-2 rounded-full ${ATHLETE.sensorsConnected ? "bg-accent" : "bg-muted"}`} />
          {ATHLETE.sensorsConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <BodyMetricReminder />

      <PassiveBaselineRecorder />
      <StrainRecorder />

      <ScoreCard label="Readiness Score" score={READINESS.score} description={READINESS.description} />

      <div className="bg-surface rounded-2xl p-3.5 my-2">
        <div className="flex justify-between items-center">
          <div className="text-[11px] tracking-wider text-muted uppercase">This Week</div>
          <div className="px-3 py-1.5 rounded-full bg-deep text-xs">{workoutsThisWeek} of 7 days trained</div>
        </div>
        <WeekBars days={WEEK_SUMMARY} />
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-track">
          <div className="flex flex-col gap-0.5">
            <span className="font-serif font-light text-2xl">{workoutsThisWeek}</span>
            <span className="text-[11px] text-muted">workouts this week</span>
          </div>
          <div className="flex flex-col gap-0.5 items-end">
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent">
              ↑ {WEEKLY_READINESS_TREND_PCT}%
            </span>
            <span className="text-[11px] text-muted">readiness vs last week</span>
          </div>
        </div>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Muscles Worked Today</h3>
      <div className="bg-[#FAFAFA] rounded-2xl p-3.5">
        <BodyMap muscles={todayMuscles} className="w-full h-auto block" />
        <Legend />
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Muscle Group Breakdown</h3>
      <MuscleStatList
        items={[
          { name: "Chest, Abs & Quads", value: "Primary", color: "#C8202F" },
          { name: "Biceps & Shoulders", value: "Secondary", color: "#F0B429" },
          { name: "Calves & Forearms", value: "Untargeted", color: "#9CA3AF" },
        ]}
      />

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Today's Metrics</h3>
      <StatGrid
        items={[
          { label: "Avg Activation", value: `${TODAY_METRICS.avgActivationPct}%`, color: "#7FB8C9" },
          { label: "Best Balance", value: `${TODAY_METRICS.bestImbalancePct}% diff`, color: "#7FB8C9" },
          { label: "Total Volume", value: `${TODAY_METRICS.totalVolumeReps} reps`, color: "#D9B26A" },
          { label: "Fatigue", value: TODAY_METRICS.fatigueLabel, color: "#7FB8C9" },
        ]}
      />

      <Link
        to="/workout"
        className="flex items-center justify-center h-12 rounded-full bg-accent text-bg font-semibold mt-5"
      >
        Start Workout
      </Link>
    </div>
  );
}

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

async function uploadRecording(userId: string, recordingType: 0 | 1, rawData: unknown): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("emg_recordings").insert({
    user_id: userId,
    recording_type: recordingType,
    raw_data: rawData,
  });
  if (error) throw error;
}

function PassiveBaselineRecorder() {
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
        {busy ? "Please wait…" : recording ? `Recording baseline (${secondsLeft})…` : "Start recording baseline"}
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
              {stats.median !== undefined && ` · median ${stats.median.toFixed(2)} · MAD ${stats.mad?.toFixed(2)}`}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

type StrainReading = { time_s: number; raw: number; strain_pct: number };
type StrainRecording = {
  channel: string;
  muscle: string;
  baseline: number;
  duration_s: number;
  sample_count: number;
  readings: StrainReading[];
};

function StrainRecorder() {
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
        {busy ? "Please wait…" : recording ? `Stop recording · ${elapsed}s` : "Start strain recording"}
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
            <span>{data.muscle} · {current.strain_pct.toFixed(0)}% strain</span>
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
