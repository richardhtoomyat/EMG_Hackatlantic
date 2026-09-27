import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ActivationChart, { BalanceBar } from "../components/ActivationChart";
import BodyMap from "../components/BodyMap";
import Legend from "../components/Legend";
import ScoreCard from "../components/ScoreCard";
import { MuscleStatList, StatRows } from "../components/StatGrid";
import { useAppData, useDataSource } from "../data/dataContext";
import { loadSession, type SessionDetail } from "../data/supabaseData";
import type { Session as SessionData, SetRecord } from "../data/types";
import { muscleMapForExercise } from "../lib/muscleMap";

/**
 * One workout: /session/:id (from History or the Workout summary), or
 * /session for the latest one. Sets, rest, L/R balance and each set's saved
 * activation curve.
 */
export default function Session() {
  const { id: paramId } = useParams();
  const { CURRENT_SESSION } = useAppData();
  const source = useDataSource();
  const id = paramId ?? CURRENT_SESSION?.id ?? null;
  const [detail, setDetail] = useState<SessionDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source === "mock" || source === "loading" || !id) return;
    let live = true;
    setDetail(undefined);
    setError(null);
    loadSession(id)
      .then((d) => live && setDetail(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [id, source]);

  // Demo mode (no Supabase): the mock session.
  const s: SessionData | SessionDetail | null | undefined = source === "mock" ? CURRENT_SESSION : detail;

  if (error) return <Empty title="Couldn't load this workout" text={error} />;
  if (source !== "mock" && (source === "loading" || (id && s === undefined))) {
    return <div className="bg-deep rounded-2xl p-3.5 text-sm text-muted" role="status">Loading workout…</div>;
  }
  if (!s) return <Empty title={id ? "Workout not found" : "No sessions yet"} text="Completed workouts will show up here." />;

  const muscles = s.muscleMap ?? muscleMapForExercise(s.exerciseName);
  const full = source === "mock" ? null : detail ?? null; // saved-session extras (times, curves)
  const traces = full?.traces ?? {};
  const started = full ? new Date(full.startedAt) : null;
  const ended = full?.endedAt ? new Date(full.endedAt) : null;
  const durationMin = started && ended ? Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60000)) : null;
  const sides = sideAverages(s.sets);

  return (
    <div className="flex-grow flex flex-col">
      <Link to="/history" className="text-xs text-accent mb-2">← History</Link>
      <div className="text-[11px] tracking-wider text-muted uppercase">
        {new Date(s.date + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ·{" "}
        {s.timeLabel}
        {durationMin ? ` · ${durationMin} min` : ""}
      </div>
      <h2 className="font-serif font-light text-[22px] mt-1" data-testid="session-title">
        {s.exerciseName} · {s.sets.length} {s.sets.length === 1 ? "Set" : "Sets"}
      </h2>

      <ScoreCard label="Session Activation Score" score={s.activationScore} description={scoreText(s.activationScore)} color="#C8202F" />

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Performance</h3>
      <StatRows
        items={[
          { label: "Total Reps", value: s.totalReps },
          { label: "Time Under Tension", value: mmss(s.totalTimeUnderTensionSec) },
          { label: "Peak Activation", value: `${s.avgPeakActivationPct}%`, color: "#C8202F" },
          { label: "Muscle Balance", value: `${s.imbalancePct}% imbalance` },
        ]}
      />
      {sides && (
        <div className="bg-deep rounded-2xl p-3.5 mt-2">
          <div className="text-[11px] tracking-wider text-muted uppercase mb-2">Left / right share</div>
          <BalanceBar left={sides.left} right={sides.right} leftLabel={sides.leftLabel} rightLabel={sides.rightLabel} />
        </div>
      )}

      {s.sets.length > 0 && (
        <>
          <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Sets</h3>
          <div className="flex flex-col gap-2.5" data-testid="set-list">
            {s.sets.map((set) => (
              <SetCard key={set.setNumber} set={set} trace={traces[set.setNumber]} />
            ))}
          </div>
        </>
      )}

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Muscles Targeted</h3>
      <div className="bg-[#FAFAFA] rounded-2xl p-3.5">
        <BodyMap muscles={muscles} className="w-full h-auto block" />
        <Legend />
      </div>

      {s.muscleActivations.length > 0 && (
        <>
          <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Activation by Muscle</h3>
          <MuscleStatList
            items={s.muscleActivations.map((m) => ({ name: m.muscle, value: `${m.pct}%`, color: m.pct >= 55 ? "#C8202F" : "#F0B429" }))}
          />
        </>
      )}

      {s.coachNote && (
        <>
          <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Coach Feedback</h3>
          <div className="flex gap-2.5 p-3 bg-surface rounded-2xl items-center">
            <div className="w-8 h-8 rounded-full bg-deep flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {s.coachNote.coachName.split(" ").map((w) => w[0]).join("")}
            </div>
            <div>
              <div className="text-xs text-muted">{s.coachNote.coachName}</div>
              <div className="text-sm mt-0.5">"{s.coachNote.message}"</div>
            </div>
          </div>
        </>
      )}

      {source !== "mock" && <SessionDetails id={s.id} />}

      <Link to="/history" className="flex items-center justify-center h-12 rounded-full border border-line mt-5">
        Back to History
      </Link>
    </div>
  );
}

function SetCard({ set, trace }: { set: SetRecord; trace?: [number, number | null, number | null][] }) {
  const sides = sideAverages([set]);
  return (
    <div className="bg-surface rounded-2xl p-3.5" data-testid="set-card">
      <div className="flex justify-between items-baseline">
        <div className="text-[11px] tracking-wider text-muted uppercase">Set {set.setNumber}</div>
        <div className="text-xs text-muted">
          {set.recoverySec ? `then ${mmss(set.recoverySec)} rest` : ""}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-1.5">
        <Stat label="Reps" value={set.reps} big />
        <Stat label="Tension" value={`${set.timeUnderTensionSec}s`} />
        <Stat label="Peak" value={`${set.peakActivationPct}%`} />
      </div>
      {sides && (
        <div className="mt-2.5">
          <BalanceBar left={sides.left} right={sides.right} leftLabel={sides.leftLabel} rightLabel={sides.rightLabel} />
        </div>
      )}
      {trace && trace.length > 1 && (
        <div className="bg-deep rounded-xl p-2 mt-2.5" data-testid="set-trace">
          <ActivationChart points={trace} height={80} axis />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, big = false }: { label: string; value: string | number; big?: boolean }) {
  return (
    <div>
      <div className={`font-serif ${big ? "text-[26px] leading-none" : "text-lg"}`}>{value}</div>
      <div className="text-[10.5px] text-muted mt-0.5">{label}</div>
    </div>
  );
}

/** Session ID + SQL to inspect what was written (Supabase → SQL Editor). */
function SessionDetails({ id }: { id: string }) {
  const sql = `select * from sessions where id = '${id}';\nselect * from sets where session_id = '${id}' order by set_number;`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (what: string, text: string) =>
    navigator.clipboard?.writeText(text).then(() => setCopied(what), () => setCopied(null));
  return (
    <details className="bg-deep rounded-2xl p-3.5 mt-5 border border-line" data-testid="session-details">
      <summary className="text-[11px] tracking-wider text-muted uppercase cursor-pointer">Details</summary>
      <div className="flex justify-between items-center mt-3">
        <div className="text-[11px] tracking-wider text-muted uppercase">Session ID</div>
        <button className="text-xs text-accent" onClick={() => copy("id", id)}>{copied === "id" ? "Copied" : "Copy ID"}</button>
      </div>
      <div className="font-mono text-xs break-all mt-1" data-testid="session-id">{id}</div>
      <div className="flex justify-between items-center mt-3">
        <div className="text-[11px] tracking-wider text-muted uppercase">Check it in Supabase</div>
        <button className="text-xs text-accent" onClick={() => copy("sql", sql)}>{copied === "sql" ? "Copied" : "Copy SQL"}</button>
      </div>
      <pre className="font-mono text-[11px] text-soft whitespace-pre-wrap break-all mt-1">{sql}</pre>
    </details>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">{title}</h2>
      <p className="text-sm text-muted mt-2">{text}</p>
      <Link to="/history" className="flex items-center justify-center h-12 rounded-full bg-accent text-bg font-semibold mt-5">
        Go to History
      </Link>
    </div>
  );
}

/** Average left / right activation over sets, from muscle_pct keys like "Left Bicep" / "Right Bicep". */
function sideAverages(sets: SetRecord[]) {
  const l: number[] = [];
  const r: number[] = [];
  let leftLabel = "Left";
  let rightLabel = "Right";
  for (const s of sets) {
    for (const [k, v] of Object.entries(s.musclePct ?? {})) {
      if (/^left\b/i.test(k)) {
        l.push(v);
        leftLabel = k;
      } else if (/^right\b/i.test(k)) {
        r.push(v);
        rightLabel = k;
      }
    }
  }
  if (!l.length && !r.length) return null;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return { left: mean(l), right: mean(r), leftLabel, rightLabel };
}

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

function scoreText(score: number) {
  if (score >= 80) return "Strong, well-balanced work";
  if (score >= 60) return "Solid session";
  if (score > 0) return "Room to push harder or even out both sides";
  return "No activation recorded";
}
