import QRCode from "qrcode";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Link } from "react-router-dom";
import { useRefreshData } from "../data/dataContext";
import { EXERCISES } from "../data/mockData";
import { sideLabels } from "../data/testSession";
import type { Sample, StationInfo } from "../lib/stationApi";
import { PLOT_WINDOW_MS, useConnectCode, useStation } from "../lib/useStation";
import ActivationRing from "./ActivationRing";
import { StatRows } from "./StatGrid";

const LEFT = "#D9B26A";
const RIGHT = "#7FB8C9";

/**
 * Workout screen when signed in: connect to a shared sensor station with a QR
 * code, watch the live signal, and record. The station saves the workout to
 * this account (through the Vercel API).
 */
export default function StationRecorder() {
  const refresh = useRefreshData();
  const st = useStation(refresh);
  const [exerciseName, setExerciseName] = useState(Object.keys(EXERCISES)[0]);

  if (st.station === undefined) return <Notice text="Checking for a connected station…" />;
  if (st.station === null) return <ConnectCard onConnected={() => void st.refreshStation()} error={st.error} />;

  const recording = st.phase === "recording" || st.phase === "finishing";
  const labels = sideLabels(st.exercise ?? exerciseName);
  const m = st.metrics;

  return (
    <div className="flex-grow flex flex-col">
      <div className="flex justify-between items-start mb-4 gap-3">
        <div className="min-w-0">
          <div className="text-[11px] tracking-wider text-muted uppercase">
            {st.phase === "recording" ? `Recording · Set ${m?.set_number ?? 1}` : "Workout"}
          </div>
          <h2 className="font-serif font-light text-[22px] truncate">
            {recording || st.phase === "starting" ? st.exercise ?? "Workout" : "Start a session"}
          </h2>
        </div>
        {st.phase === "recording" ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-max text-xs shrink-0">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Live
          </div>
        ) : (
          <StationPill station={st.station} />
        )}
      </div>

      <EnvelopePlot samples={st.samples} tick={st.sampleTick} left={labels.left} right={labels.right} />

      {(st.phase === "idle" || st.phase === "done") && (
        <div className="bg-surface rounded-2xl p-3.5 flex flex-col gap-3 mt-3">
          <label className="text-xs text-muted" htmlFor="exercise">Exercise</label>
          <select id="exercise" value={exerciseName} onChange={(e) => setExerciseName(e.target.value)}
            className="h-11 rounded-xl bg-deep border border-line px-3 text-sm text-ink">
            {Object.keys(EXERCISES).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="text-xs text-muted">
            Sensors: left on <b className="text-soft">{sideLabels(exerciseName).left}</b>, right on{" "}
            <b className="text-soft">{sideLabels(exerciseName).right}</b>
          </div>
          <button onClick={() => void st.start(exerciseName)} disabled={!st.station.online}
            className="h-12 rounded-full bg-accent text-bg font-semibold disabled:opacity-50">
            Start recording
          </button>
          {!st.station.online && (
            <div className="text-xs text-muted">The station is offline — is <code>station.py</code> running on it?</div>
          )}
        </div>
      )}

      {st.phase === "starting" && <Notice text="Creating the session and telling the station…" />}

      {recording && (
        <>
          <div className="grid grid-cols-2 gap-3 my-3">
            <div className="text-center">
              <ActivationRing value={m?.left_pct ?? 0} color={LEFT} size={130} />
              <div className="text-[11px] tracking-wider text-muted uppercase mt-2">{labels.left}</div>
            </div>
            <div className="text-center">
              <ActivationRing value={m?.right_pct ?? 0} color={RIGHT} size={130} />
              <div className="text-[11px] tracking-wider text-muted uppercase mt-2">{labels.right}</div>
            </div>
          </div>
          <div className="bg-deep rounded-2xl p-3.5">
            <div className="flex justify-between items-center">
              <div className="text-[11px] tracking-wider text-muted uppercase">Imbalance (this set)</div>
              <div className="font-serif text-xl">{m?.imbalance_pct ?? 0}%</div>
            </div>
            <div className="flex gap-[3px] h-2 mt-2">
              <div className="rounded" style={{ flex: Math.max(m?.left_avg_pct ?? 0, 1), background: LEFT }} />
              <div className="rounded" style={{ flex: Math.max(m?.right_avg_pct ?? 0, 1), background: RIGHT }} />
            </div>
          </div>
          <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Set {m?.set_number ?? 1}</h3>
          <StatRows
            items={[
              { label: "Reps", value: m?.reps ?? 0 },
              { label: "Time Under Tension", value: `${m?.tut_sec ?? 0}s` },
              { label: "Peak Activation", value: `${m?.peak_pct ?? 0}%`, color: "#E07A5F" },
              { label: "Sets done", value: m?.completed_sets ?? 0 },
            ]}
          />
          {st.phase === "recording" ? (
            <>
              <div className="grid grid-cols-2 gap-2 mt-5">
                <button onClick={() => void st.nextSet()} className="h-12 rounded-full border border-line">Next set</button>
                <button onClick={() => void st.finish()} className="h-12 rounded-full bg-accent text-bg font-semibold">Finish</button>
              </div>
              <button onClick={() => void st.cancel()} className="text-xs text-muted mt-3 self-center">
                Cancel and delete this session
              </button>
            </>
          ) : (
            <Notice text="Finishing — the station is saving your sets…" />
          )}
        </>
      )}

      {st.phase === "done" && (
        <div className="bg-surface rounded-2xl p-3.5 mt-3 flex items-center justify-between" role="status">
          <div className="text-sm">✓ Session saved</div>
          <div className="flex gap-3 text-sm">
            <Link to="/session" className="text-accent">View session</Link>
            <button className="text-muted" onClick={st.reset}>Dismiss</button>
          </div>
        </div>
      )}

      {st.error && <div role="alert" className="text-sm text-max mt-3">{st.error}</div>}

      {(st.sessionId ?? st.savedSessionId) && <SessionIdPanel id={(st.sessionId ?? st.savedSessionId)!} />}

      <button onClick={() => void st.disconnect()} className="h-11 rounded-full border border-line text-sm mt-5">
        Disconnect from {st.station.name}
      </button>
      {recording && <div className="text-xs text-muted mt-1.5 self-center">Disconnecting discards the unfinished workout.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ConnectCard({ onConnected, error }: { onConnected: () => void; error: string | null }) {
  const c = useConnectCode(true, onConnected);
  const [img, setImg] = useState<string | null>(null);

  useEffect(() => {
    if (!c.code) return setImg(null);
    let live = true;
    QRCode.toDataURL(c.code.qr, { margin: 2, width: 480, errorCorrectionLevel: "M" }).then((url) => live && setImg(url));
    return () => {
      live = false;
    };
  }, [c.code]);

  const showing = c.status === "waiting" && c.code;
  return (
    <div className="flex-grow flex flex-col">
      <div className="text-[11px] tracking-wider text-muted uppercase">Workout</div>
      <h2 className="font-serif font-light text-[22px] mb-4">Connect to a station</h2>
      {error && <div role="alert" className="text-sm text-max mb-3">{error}</div>}

      <div className="bg-surface rounded-2xl p-4 flex flex-col items-center gap-3 text-center">
        {showing ? (
          <>
            {img ? (
              <img src={img} alt="Connect QR code" className="rounded-xl bg-white" style={{ width: 240, height: 240 }} data-testid="connect-qr" />
            ) : (
              <div className="rounded-xl bg-track" style={{ width: 240, height: 240 }} />
            )}
            <div className="text-sm text-soft">Hold this up to the station's camera</div>
            <div className="text-xs text-muted">or type this code in the station's terminal:</div>
            <div className="font-mono text-2xl tracking-widest" data-testid="connect-code">{c.code!.display}</div>
            <div className="text-xs text-muted" role="status">Waiting for the station… {c.secondsLeft}s</div>
          </>
        ) : (
          <>
            <p className="text-sm text-soft">
              A station is a computer with the MyoWare sensors. Show it a one-time QR code and it records for
              your account until you disconnect.
            </p>
            {c.status === "expired" && <div className="text-xs text-max">That code expired.</div>}
            {c.error && <div role="alert" className="text-xs text-max">{c.error}</div>}
            <button onClick={() => void c.create()} disabled={c.status === "loading"}
              className="h-12 px-6 rounded-full bg-accent text-bg font-semibold disabled:opacity-60">
              {c.status === "expired" ? "New QR code" : "Show QR code"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StationPill({ station }: { station: StationInfo }) {
  const dot = (on?: boolean) => `w-2 h-2 rounded-full ${on ? "bg-accent" : "bg-muted"}`;
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface text-xs shrink-0" data-testid="station-pill">
      <span className={dot(station.online)} /> {station.name}
      {station.online ? (
        <span className="inline-flex items-center gap-1 text-muted">
          · L <span className={dot(station.sensors.left)} /> R <span className={dot(station.sensors.right)} />
        </span>
      ) : (
        <span className="text-muted">· offline</span>
      )}
    </div>
  );
}

/** Raw envelope from the station (last 10 s), both sides on one auto-scaled axis. */
function EnvelopePlot({ samples, tick, left, right }: {
  samples: MutableRefObject<Sample[]>; tick: number; left: string; right: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth, h = el.clientHeight;
    if (el.width !== w * dpr) el.width = w * dpr;
    if (el.height !== h * dpr) el.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const data = samples.current;
    if (!data.length) return;
    const tEnd = data[data.length - 1][0];
    let lo = Infinity, hi = -Infinity;
    for (const [, l, r] of data) for (const v of [l, r]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) return;
    const pad = Math.max((hi - lo) * 0.1, 5);
    lo -= pad; hi += pad;
    const x = (t: number) => w - ((tEnd - t) / PLOT_WINDOW_MS) * w;
    const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
    for (const [idx, color] of [[1, LEFT], [2, RIGHT]] as const) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      let pen = false;
      for (const s of data) {
        const v = s[idx];
        if (v == null) { pen = false; continue; }
        if (pen) ctx.lineTo(x(s[0]), y(v)); else ctx.moveTo(x(s[0]), y(v));
        pen = true;
      }
      ctx.stroke();
    }
  }, [samples, tick]);

  const empty = samples.current.length === 0;
  return (
    <div className="bg-deep rounded-2xl p-3" data-testid="envelope-plot">
      <div className="flex justify-between text-[11px] tracking-wider text-muted uppercase mb-1.5">
        <span>Live signal · raw envelope</span>
        <span className="normal-case tracking-normal">
          <span style={{ color: LEFT }}>● {left}</span> <span style={{ color: RIGHT }}>● {right}</span>
        </span>
      </div>
      <div className="relative">
        <canvas ref={canvas} className="w-full block" style={{ height: 110 }} />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
            Waiting for signal from the station…
          </div>
        )}
      </div>
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
