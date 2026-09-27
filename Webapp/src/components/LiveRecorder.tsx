import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { useRefreshData } from "../data/dataContext";
import { EXERCISES } from "../data/mockData";
import { sideLabels } from "../data/testSession";
import { normalizeCode, prettyCode, useSensorLink } from "../lib/sensorLink";
import ActivationRing from "./ActivationRing";
import { StatRows } from "./StatGrid";

/** Workout screen when signed in: record a real session from the laptop bridge. */
export default function LiveRecorder() {
  const { user } = useAuth();
  const refresh = useRefreshData();
  const link = useSensorLink(user?.id ?? null, refresh);
  const [exerciseName, setExerciseName] = useState(Object.keys(EXERCISES)[0]);

  if (!link.code) return <PairingCard onPair={link.setCode} />;

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
          {!link.online && (
            <div className="text-xs text-muted">
              Waiting for the laptop — run <code className="text-soft">python src/bridge.py</code> in EMG/app.{" "}
              <button className="text-accent" onClick={() => link.setCode(null)}>Change code ({prettyCode(link.code)})</button>
            </div>
          )}
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

function PairingCard({ onPair }: { onPair: (code: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">Connect your sensors</h2>
      <ol className="text-sm text-muted mt-3 list-decimal pl-5 flex flex-col gap-1">
        <li>On the laptop with the MyoWare sensors, open <code className="text-soft">EMG/app</code>.</li>
        <li>Run <code className="text-soft">python src/bridge.py</code> — it prints a pairing code.</li>
        <li>Enter the code below (once per browser).</li>
      </ol>
      <form
        className="flex gap-2 mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const code = normalizeCode(value);
          if (!code) return setError("Codes look like ABCD-2345 (8 letters/digits).");
          onPair(code);
        }}
      >
        <input aria-label="Pairing code" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ABCD-2345"
          className="flex-1 h-12 rounded-xl bg-surface border border-line px-4 font-mono tracking-widest uppercase text-ink placeholder:text-muted" />
        <button className="h-12 px-5 rounded-xl bg-accent text-bg font-semibold">Connect</button>
      </form>
      {error && <div role="alert" className="text-sm text-max mt-2">{error}</div>}
    </div>
  );
}
