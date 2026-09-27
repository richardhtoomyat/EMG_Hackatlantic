import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import ActivationRing from "../components/ActivationRing";
import StationRecorder from "../components/StationRecorder";
import { StatRows } from "../components/StatGrid";
import { useAppData, useRefreshData } from "../data/dataContext";
import { EXERCISES } from "../data/mockData";
import { saveSession } from "../data/saveSession";
import { generateTestSession } from "../data/testSession";

export default function Workout() {
  const { enabled, user } = useAuth();
  if (enabled && user) {
    return (
      <>
        <StationRecorder />
        <SaveTestSession />
      </>
    );
  }
  return <DemoWorkout />;
}

/** Demo mode (no Supabase): the original static live-set design with mock data. */
function DemoWorkout() {
  const { LIVE_SET } = useAppData();
  return (
    <div className="flex-grow flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-[11px] tracking-wider text-muted uppercase">Active Session</div>
          <h2 className="font-serif font-light text-[22px]">{LIVE_SET.exerciseName}</h2>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-max text-xs">
          <span className="w-2 h-2 rounded-full bg-max" />
          Live
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 my-4">
        <div className="text-center">
          <ActivationRing value={LIVE_SET.leftPct} color="#D9B26A" size={140} />
          <div className="text-[11px] tracking-wider text-muted uppercase mt-2">Left Bicep</div>
        </div>
        <div className="text-center">
          <ActivationRing value={LIVE_SET.rightPct} color="#7FB8C9" size={140} />
          <div className="text-[11px] tracking-wider text-muted uppercase mt-2">Right Bicep</div>
        </div>
      </div>

      <div className="bg-deep rounded-2xl p-3.5">
        <div className="flex justify-between items-center">
          <div className="text-[11px] tracking-wider text-muted uppercase">Imbalance</div>
          <div className="font-serif text-xl">{LIVE_SET.imbalancePct}%</div>
        </div>
        <div className="flex gap-[3px] h-2 mt-2">
          <div className="rounded flex-[55]" style={{ background: "#D9B26A" }} />
          <div className="rounded flex-[45]" style={{ background: "#7FB8C9" }} />
        </div>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Set Metrics</h3>
      <StatRows
        items={[
          { label: "Reps", value: LIVE_SET.reps },
          { label: "Time Under Tension", value: LIVE_SET.timeUnderTension },
          { label: "Peak Activation", value: `${LIVE_SET.peakActivationPct}%`, color: "#E07A5F" },
          { label: "Fatigue Level", value: LIVE_SET.fatigueLabel, color: "#D9B26A" },
        ]}
      />

      <Link
        to="/session"
        className="flex items-center justify-center h-12 rounded-full border border-line mt-5"
      >
        End Set
      </Link>

    </div>
  );
}

/**
 * Until the EMG sensor streams real sets, this writes a generated workout to
 * Supabase through the real insert path (saveSession) so every screen can be
 * tested against rows the app itself created.
 */
function SaveTestSession() {
  const { user, enabled } = useAuth();
  const refresh = useRefreshData();
  const navigate = useNavigate();
  const [exercise, setExercise] = useState(Object.keys(EXERCISES)[0]);
  const [status, setStatus] = useState<{ kind: "error" | "busy"; text: string } | null>(null);

  if (!enabled || !user) return null;

  const onSave = async () => {
    setStatus({ kind: "busy", text: "Saving…" });
    try {
      await saveSession(user.id, generateTestSession(exercise));
      await refresh();
      navigate("/session");
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
      setStatus({ kind: "error", text: msg });
    }
  };

  return (
    <div className="bg-deep rounded-2xl p-3.5 mt-6 border border-dashed border-line">
      <div className="text-[11px] tracking-wider text-muted uppercase">Test tools</div>
      <p className="text-xs text-muted mt-1">
        Save a generated session for this account to Supabase, then open it.
      </p>
      <div className="flex gap-2 mt-3">
        <select
          aria-label="Exercise"
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
          className="flex-1 h-11 rounded-xl bg-surface border border-line px-3 text-sm text-ink"
        >
          {Object.keys(EXERCISES).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button
          onClick={onSave}
          disabled={status?.kind === "busy"}
          className="h-11 px-4 rounded-xl bg-accent text-bg text-sm font-semibold disabled:opacity-60"
        >
          {status?.kind === "busy" ? "Saving…" : "Save test session"}
        </button>
      </div>
      {status?.kind === "error" && (
        <div role="alert" className="text-xs text-max mt-2">Couldn't save: {status.text}</div>
      )}
    </div>
  );
}
