import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { useRefreshData } from "../data/dataContext";
import { EXERCISES } from "../data/mockData";
import { sideLabels } from "../data/testSession";
import { useSensorLink } from "../lib/sensorLink";
import ActivationRing from "./ActivationRing";
import { StatRows } from "./StatGrid";

/** Workout screen when signed in: record a real session from the laptop bridge. */
export default function LiveRecorder() {
  const { user } = useAuth();
  const refresh = useRefreshData();
  const link = useSensorLink(user?.id ?? null, refresh);
  const [exerciseName, setExerciseName] = useState(Object.keys(EXERCISES)[0]);

  const busy = link.phase === "starting" || link.phase === "recording" || link.phase === "finishing" || link.phase === "saving";
  const labels = sideLabels(link.exercise ?? exerciseName);
  const live = link.live;
  const left = live?.left_pct ?? 0;
  const right = live?.right_pct ?? 0;
  const leftAvg = live?.left_avg_pct ?? 0;
  const rightAvg = live?.right_avg_pct ?? 0;

  return (
    <div className="flex-grow flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-[11px] tracking-wider text-muted uppercase">
            {link.phase === "recording" ? `Recording · Set ${live?.set_number ?? 1}` : "Workout"}
          </div>
          <h2 className="font-serif font-light text-[22px]">{busy ? link.exercise : "Start a session"}</h2>
        </div>
        {link.phase === "recording" ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-max text-xs">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Live
          </div>
        ) : (
          <DevicePill online={link.online} left={link.device?.sensors.left} right={link.device?.sensors.right} />
        )}
      </div>

      {!busy && (
        <div className="bg-surface rounded-2xl p-3.5 flex flex-col gap-3">
          <label className="text-xs text-muted" htmlFor="exercise">Exercise</label>
          <select id="exercise" value={exerciseName} onChange={(e) => setExerciseName(e.target.value)}
            className="h-11 rounded-xl bg-deep border border-line px-3 text-sm text-ink">
            {Object.keys(EXERCISES).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="text-xs text-muted">
            Sensors: left on <b className="text-soft">{sideLabels(exerciseName).left}</b>, right on{" "}
            <b className="text-soft">{sideLabels(exerciseName).right}</b>
          </div>
          <button onClick={() => void link.start(exerciseName)} disabled={!link.online}
            className="h-12 rounded-full bg-accent text-bg font-semibold disabled:opacity-50">
            Start recording
          </button>
          {!link.online && <ConnectHelp email={user?.email ?? "you@example.com"} />}
        </div>
      )}

      {link.phase === "starting" && <Notice text="Creating the session and waiting for the laptop…" />}

      {(link.phase === "recording" || link.phase === "finishing" || link.phase === "saving") && (
        <>
          <div className="grid grid-cols-2 gap-3 my-2">
            <div className="text-center">
              <ActivationRing value={left} color="#D9B26A" size={140} />
              <div className="text-[11px] tracking-wider text-muted uppercase mt-2">{labels.left}</div>
            </div>
            <div className="text-center">
              <ActivationRing value={right} color="#7FB8C9" size={140} />
              <div className="text-[11px] tracking-wider text-muted uppercase mt-2">{labels.right}</div>
            </div>
          </div>
          <div className="bg-deep rounded-2xl p-3.5">
            <div className="flex justify-between items-center">
              <div className="text-[11px] tracking-wider text-muted uppercase">Imbalance (this set)</div>
              <div className="font-serif text-xl">{live?.imbalance_pct ?? 0}%</div>
            </div>
            <div className="flex gap-[3px] h-2 mt-2">
              <div className="rounded" style={{ flex: Math.max(leftAvg, 1), background: "#D9B26A" }} />
              <div className="rounded" style={{ flex: Math.max(rightAvg, 1), background: "#7FB8C9" }} />
            </div>
          </div>
          <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Set {live?.set_number ?? 1}</h3>
          <StatRows
            items={[
              { label: "Reps", value: live?.reps ?? 0 },
              { label: "Time Under Tension", value: `${live?.tut_sec ?? 0}s` },
              { label: "Peak Activation", value: `${live?.peak_pct ?? 0}%`, color: "#E07A5F" },
              { label: "Sets saved", value: link.savedSets.length ? link.savedSets.join(", ") : "—" },
            ]}
          />
          {link.phase === "recording" ? (
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={link.nextSet} className="h-12 rounded-full border border-line">Next set</button>
              <button onClick={link.finish} className="h-12 rounded-full bg-accent text-bg font-semibold">Finish</button>
            </div>
          ) : (
            <Notice text={link.phase === "finishing" ? "Finishing — waiting for the summary…" : "Saving to Supabase…"} />
          )}
          {link.phase === "recording" && (
            <button onClick={() => void link.cancel()} className="text-xs text-muted mt-3 self-center">
              Cancel and delete this session
            </button>
          )}
        </>
      )}

      {link.phase === "done" && (
        <div className="bg-surface rounded-2xl p-3.5 mt-3 flex items-center justify-between">
          <div className="text-sm">✓ Session saved</div>
          <div className="flex gap-3 text-sm">
            <Link to="/session" className="text-accent">View session</Link>
            <button className="text-muted" onClick={link.reset}>New</button>
          </div>
        </div>
      )}

      {link.error && <div role="alert" className="text-sm text-max mt-3">{link.error}</div>}
      {link.error && link.phase === "error" && (
        <button onClick={link.reset} className="text-xs text-muted mt-2 self-start">Dismiss</button>
      )}

      {link.sessionId && <SessionIdPanel id={link.sessionId} />}
    </div>
  );
}

function DevicePill({ online, left, right }: { online: boolean; left?: boolean; right?: boolean }) {
  const dot = (on?: boolean) => `w-2 h-2 rounded-full ${on ? "bg-accent" : "bg-muted"}`;
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface text-xs" data-testid="device-pill">
      <span className={dot(online)} /> {online ? "Laptop online" : "Laptop offline"}
      {online && (
        <span className="inline-flex items-center gap-1 text-muted">
          · L <span className={dot(left)} /> R <span className={dot(right)} />
        </span>
      )}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="bg-deep rounded-2xl p-3.5 mt-3 text-sm text-muted" role="status">{text}</div>;
}

/** Session ID + SQL to inspect what was written, e.g. in Supabase → SQL Editor. */
function SessionIdPanel({ id }: { id: string }) {
  const sql = `select * from sessions where id = '${id}';\nselect * from sets where session_id = '${id}' order by set_number;`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (what: string, text: string) =>
    navigator.clipboard?.writeText(text).then(() => setCopied(what), () => setCopied(null));
  return (
    <div className="bg-deep rounded-2xl p-3.5 mt-5 border border-line" data-testid="session-id-panel">
      <div className="flex justify-between items-center">
        <div className="text-[11px] tracking-wider text-muted uppercase">Session ID</div>
        <button className="text-xs text-accent" onClick={() => copy("id", id)}>{copied === "id" ? "Copied" : "Copy ID"}</button>
      </div>
      <div className="font-mono text-xs break-all mt-1" data-testid="session-id">{id}</div>
      <div className="flex justify-between items-center mt-3">
        <div className="text-[11px] tracking-wider text-muted uppercase">Check it in Supabase</div>
        <button className="text-xs text-accent" onClick={() => copy("sql", sql)}>{copied === "sql" ? "Copied" : "Copy SQL"}</button>
      </div>
      <pre className="font-mono text-[11px] text-soft whitespace-pre-wrap break-all mt-1">{sql}</pre>
    </div>
  );
}

/** How to connect: everything happens in the laptop terminal. */
function ConnectHelp({ email }: { email: string }) {
  return (
    <div className="text-xs text-muted flex flex-col gap-1" data-testid="connect-help">
      <div>Waiting for the laptop. On the computer with the sensors, in <code className="text-soft">EMG/app</code>:</div>
      <code className="block bg-deep rounded-lg px-2.5 py-2 text-soft break-all">python src/bridge.py --email {email}</code>
      <div>It connects to this account automatically (the email is remembered after the first run).</div>
    </div>
  );
}
