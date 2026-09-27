import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BodyMap from "../components/BodyMap";
import Legend from "../components/Legend";
import ScoreCard from "../components/ScoreCard";
import StatGrid from "../components/StatGrid";
import WeekBars from "../components/WeekBars";
import { MuscleStatList } from "../components/StatGrid";
import BodyMetricReminder from "../components/BodyMetricReminder";
import { useAppData } from "../data/dataContext";
import { mergeExercises } from "../lib/muscleMap";

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

function PassiveBaselineRecorder() {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [summary, setSummary] = useState<PassiveSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setSecondsLeft(5);
      setRecording(true);
      window.setTimeout(() => {
        setBusy(true);
        void endPassiveRecording()
          .then(setSummary)
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
