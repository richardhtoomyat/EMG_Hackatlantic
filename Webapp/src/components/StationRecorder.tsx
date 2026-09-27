import QRCode from "qrcode";
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { useRefreshData } from "../data/dataContext";
import { EXERCISES } from "../data/mockData";
import { loadSession, type SessionDetail } from "../data/supabaseData";
import { sideLabels } from "../data/testSession";
import {
  cancelCalibration,
  finishCalibration,
  getCalibration,
  markSqueeze,
  needsCalibration,
  RELAX_S,
  saveCalibration,
  SQUEEZE_S,
  startCalibration,
  type Calibration,
  type CalibrationResult,
} from "../lib/calibration";
import { muscleMapForExercise } from "../lib/muscleMap";
import type { LiveMetrics, Sample, StationInfo } from "../lib/stationApi";
import { supabase } from "../lib/supabase";
import { PLOT_WINDOW_MS, useConnectCode, useStation } from "../lib/useStation";
import ActivationChart, { BalanceBar, LEFT_COLOR, RIGHT_COLOR } from "./ActivationChart";
import ActivationRing from "./ActivationRing";
import BodyMap from "./BodyMap";

const LEFT = LEFT_COLOR;
const RIGHT = RIGHT_COLOR;

/**
 * Workout screen when signed in, after connecting to a sensor station by QR:
 *   ready     — pick the exercise, see where the sensors go, check both respond
 *   recording — big L/R rings, reps, balance, live activation chart, rest timer
 *   done      — summary of the saved workout, with a link to it in History
 * The station saves every set to this account (through the Vercel API).
 */
export default function StationRecorder() {
  const refresh = useRefreshData();
  const st = useStation(refresh);
  const { user } = useAuth();
  const [exerciseName, setExerciseName] = useState(Object.keys(EXERCISES)[0]);
  const [, setCalTick] = useState(0); // re-read the stored calibration after calibrating
  const calibration = user ? getCalibration(user.id, exerciseName) : null;

  if (st.station === undefined) return <Notice text="Checking for a connected station…" />;
  if (st.station === null) return <ConnectCard onConnected={() => void st.refreshStation()} error={st.error} />;

  const station = st.station;
  const recording = st.phase === "recording" || st.phase === "finishing";

  return (
    <div className="flex-grow flex flex-col">
      <div className="flex justify-between items-center mb-3 gap-2">
        <StationPill station={station} />
        {!recording && (
          <button onClick={() => void st.disconnect()} className="text-xs text-muted underline-offset-2 hover:underline">
            Disconnect
          </button>
        )}
      </div>

      {st.phase === "starting" && <Notice text="Starting — telling the station…" />}

      {(st.phase === "idle") && (
        <ReadyView
          exercise={exerciseName}
          onExercise={setExerciseName}
          station={station}
          metrics={st.metrics}
          userId={user?.id ?? null}
          calibration={calibration}
          onCalibrated={() => setCalTick((n) => n + 1)}
          onStart={() => void st.start(exerciseName, needsCalibration(exerciseName) ? calibration : null)}
        />
      )}

      {recording && (
        <LiveView
          exercise={st.exercise ?? "Workout"}
          sessionId={st.sessionId}
          metrics={st.metrics}
          pct={st.pct}
          startedAt={st.startedAt}
          setStartedAt={st.setStartedAtMs}
          finishing={st.phase === "finishing"}
          onNextSet={() => void st.nextSet()}
          onFinish={() => void st.finish()}
          onCancel={() => void st.cancel()}
        />
      )}

      {st.phase === "done" && st.savedSessionId && <DoneView sessionId={st.savedSessionId} onNew={st.reset} />}

      {st.error && <div role="alert" className="text-sm text-max mt-3">{st.error}</div>}

      {recording && (
        <button onClick={() => void st.disconnect()} className="text-xs text-muted mt-4 self-center">
          Disconnect from {station.name} (discards this workout)
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ReadyView({ exercise, onExercise, station, metrics, userId, calibration, onCalibrated, onStart }: {
  exercise: string;
  onExercise: (name: string) => void;
  station: StationInfo;
  metrics: LiveMetrics | null;
  userId: string | null;
  calibration: Calibration | null;
  onCalibrated: () => void;
  onStart: () => void;
}) {
  const labels = sideLabels(exercise);
  const [recalibrating, setRecalibrating] = useState(false);
  useEffect(() => setRecalibrating(false), [exercise]);
  const mustCalibrate = needsCalibration(exercise) && !!userId && (!calibration || recalibrating);
  const both = station.sensors.left && station.sensors.right;
  const sensorNote = !station.online
    ? "The station is offline — is station.py running on it?"
    : both
      ? "Both sensors are live — flex to see them move."
      : station.sensors.left || station.sensors.right
        ? `Only the ${station.sensors.left ? "left" : "right"} sensor is sending — check the other one.`
        : "No sensor data yet — are the shields on?";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[11px] tracking-wider text-muted uppercase">Workout</div>
        <h2 className="font-serif font-light text-[22px]">Choose your exercise</h2>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Exercise">
        {Object.keys(EXERCISES).map((name) => (
          <button
            key={name}
            role="radio"
            aria-checked={name === exercise}
            onClick={() => onExercise(name)}
            className={`h-9 px-3.5 rounded-full text-sm border ${
              name === exercise ? "bg-accent text-bg border-accent font-semibold" : "border-line text-soft"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="bg-surface rounded-2xl p-3.5">
        <div className="text-[11px] tracking-wider text-muted uppercase mb-2">Sensor placement</div>
        <div className="bg-[#FAFAFA] rounded-xl p-2">
          <BodyMap muscles={muscleMapForExercise(exercise)} className="w-full h-auto block max-h-56" />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2.5 text-sm">
          <div><span style={{ color: LEFT }}>●</span> Left sensor<div className="text-soft font-medium">{labels.left}</div></div>
          <div><span style={{ color: RIGHT }}>●</span> Right sensor<div className="text-soft font-medium">{labels.right}</div></div>
        </div>
      </div>

      <div className="bg-surface rounded-2xl p-3.5" data-testid="sensor-check">
        <div className="text-[11px] tracking-wider text-muted uppercase mb-2">Sensor check</div>
        <LevelBar label="Left" value={metrics?.left_pct} color={LEFT} live={!!station.sensors.left} />
        <LevelBar label="Right" value={metrics?.right_pct} color={RIGHT} live={!!station.sensors.right} />
        <div className="text-xs text-muted mt-2">{sensorNote}</div>
      </div>

      {mustCalibrate ? (
        <CalibrationCard
          key={exercise}
          exercise={exercise}
          userId={userId!}
          online={station.online}
          metrics={metrics}
          canCancel={recalibrating}
          onCancel={() => setRecalibrating(false)}
          onDone={() => {
            setRecalibrating(false);
            onCalibrated();
          }}
        />
      ) : (
        <>
          {needsCalibration(exercise) && calibration && (
            <div className="flex justify-between items-center text-xs text-muted px-1" data-testid="calibrated">
              <span>✓ Calibrated at {new Date(calibration.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
              <button className="text-accent" onClick={() => setRecalibrating(true)}>Recalibrate</button>
            </div>
          )}
          <button onClick={onStart} disabled={!station.online}
            className="h-14 rounded-full bg-accent text-bg text-[17px] font-semibold disabled:opacity-50">
            Start workout
          </button>
        </>
      )}
    </div>
  );
}

type CalPhase = "intro" | "relax" | "squeeze" | "saving" | "result";

/** Relax (RELAX_S) → squeeze as hard as possible (SQUEEZE_S) → the station computes rest / max per side. */
function CalibrationCard({ exercise, userId, online, metrics, canCancel, onCancel, onDone }: {
  exercise: string;
  userId: string;
  online: boolean;
  metrics: LiveMetrics | null;
  canCancel: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<CalPhase>("intro");
  const [stepStart, setStepStart] = useState(0);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const timer = useRef(0);
  const now = useNow(250);
  const labels = sideLabels(exercise);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setPhase("intro");
  };

  const run = async () => {
    setError(null);
    setResult(null);
    try {
      token.current = await startCalibration(userId, exercise);
      setPhase("relax");
      setStepStart(Date.now());
      timer.current = window.setTimeout(async () => {
        try {
          await markSqueeze();
          setPhase("squeeze");
          setStepStart(Date.now());
          timer.current = window.setTimeout(async () => {
            setPhase("saving");
            try {
              const r = await finishCalibration(userId, token.current);
              setResult(r);
              setPhase("result"); // saved (and the card closed) when "Continue" is tapped
            } catch (e) {
              fail(e);
            }
          }, SQUEEZE_S * 1000);
        } catch (e) {
          fail(e);
        }
      }, RELAX_S * 1000);
    } catch (e) {
      fail(e);
    }
  };

  const stop = () => {
    window.clearTimeout(timer.current);
    void cancelCalibration().catch(() => {});
    setPhase("intro");
  };

  const left = (phase === "relax" ? RELAX_S : SQUEEZE_S) - Math.floor((now - stepStart) / 1000);
  return (
    <div className="bg-surface rounded-2xl p-3.5 border border-accent/40" data-testid="calibration">
      <div className="text-[11px] tracking-wider text-accent uppercase">Calibrate {exercise}</div>
      {phase === "intro" && (
        <>
          <p className="text-sm text-soft mt-1.5">
            Once per login, so 100% means <b>your</b> maximum squeeze. Takes {RELAX_S + SQUEEZE_S} seconds:
          </p>
          <ol className="text-sm text-muted mt-2 space-y-1 list-decimal list-inside">
            <li>Relax both arms completely ({RELAX_S} s)</li>
            <li>Curl and squeeze both {labels.left.replace(/^Left /, "").toLowerCase()}s as hard as you can ({SQUEEZE_S} s)</li>
          </ol>
          {error && <div role="alert" className="text-xs text-max mt-2">{error}</div>}
          <button onClick={() => void run()} disabled={!online}
            className="w-full h-12 rounded-full bg-accent text-bg font-semibold mt-3 disabled:opacity-50">
            Start calibration
          </button>
          {canCancel && <button onClick={onCancel} className="w-full text-xs text-muted mt-2">Keep the current calibration</button>}
        </>
      )}
      {(phase === "relax" || phase === "squeeze") && (
        <div className="text-center py-2" data-testid="calibration-step">
          <div className="text-[13px] text-soft">{phase === "relax" ? "Relax both arms" : "Squeeze as hard as you can!"}</div>
          <div className={`font-serif text-[56px] leading-none mt-1 tabular-nums ${phase === "squeeze" ? "text-max" : ""}`}>
            {Math.max(1, left)}
          </div>
          <div className="text-xs text-muted mt-1">Step {phase === "relax" ? 1 : 2} of 2</div>
          <div className="mt-3 text-left">
            <LevelBar label="Left" value={metrics?.left_pct} color={LEFT} live />
            <LevelBar label="Right" value={metrics?.right_pct} color={RIGHT} live />
          </div>
          <button onClick={stop} className="text-xs text-muted mt-2">Cancel</button>
        </div>
      )}
      {phase === "saving" && <div className="text-sm text-muted py-3" role="status">Calculating your rest and max…</div>}
      {phase === "result" && result && (
        <div data-testid="calibration-result">
          <div className="grid grid-cols-2 gap-2 mt-2">
            {(["left", "right"] as const).map((side) => {
              const r = result.sides[side];
              return (
                <div key={side} className="bg-deep rounded-xl p-2.5 text-xs">
                  <div className="text-soft font-medium">{side === "left" ? labels.left : labels.right} {r?.ok ? "✓" : "✗"}</div>
                  {r?.mvc != null ? (
                    <div className="text-muted mt-0.5">rest {Math.round(r.rest ?? 0)} · max {Math.round(r.mvc)}</div>
                  ) : null}
                  {!r?.ok && <div className="text-max mt-0.5">{r?.problem ?? "no data"}</div>}
                </div>
              );
            })}
          </div>
          {result.ok ? (
            <button
              onClick={() => {
                saveCalibration(userId, result);
                onDone();
              }}
              className="w-full h-12 rounded-full bg-accent text-bg font-semibold mt-3"
            >
              Continue
            </button>
          ) : (
            <button onClick={() => void run()} className="w-full h-12 rounded-full border border-line mt-3">Try again</button>
          )}
        </div>
      )}
    </div>
  );
}

function LevelBar({ label, value, color, live }: { label: string; value: number | null | undefined; color: string; live: boolean }) {
  const v = live && value != null ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="flex items-center gap-2.5 my-1">
      <div className="w-10 text-xs text-soft">{label}</div>
      <div className="flex-1 h-2.5 rounded-full bg-track overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${v}%`, background: color }} />
      </div>
      <div className="w-10 text-right text-xs text-muted">{live && value != null ? `${Math.round(value)}%` : "—"}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
type DoneSet = { set_number: number; reps: number | null; time_under_tension_seconds: number | null };

function LiveView(props: {
  exercise: string;
  sessionId: string | null;
  metrics: LiveMetrics | null;
  pct: MutableRefObject<[number, number | null, number | null][]>;
  startedAt: number | null;
  setStartedAt: number | null;
  finishing: boolean;
  onNextSet: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const { exercise, sessionId, metrics: m, pct, startedAt, setStartedAt, finishing } = props;
  const now = useNow(1000);
  const labels = sideLabels(exercise);
  const setNumber = m?.set_number ?? 1;
  const reps = m?.reps ?? 0;
  const tut = m?.tut_sec ?? 0;
  // After "Next set", until the new set shows any tension: resting.
  const resting = setNumber > 1 && reps === 0 && tut === 0;
  const done = useCompletedSets(sessionId, m?.completed_sets ?? 0);

  return (
    <div className="flex flex-col">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="text-[11px] tracking-wider text-muted uppercase">Set {setNumber}</div>
          <h2 className="font-serif font-light text-[22px] truncate">{exercise}</h2>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-max text-xs">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Live
          </div>
          {startedAt && <div className="text-xs text-muted tabular-nums" data-testid="elapsed">{clock(now - startedAt)}</div>}
        </div>
      </div>

      {resting && (
        <div className="bg-deep rounded-2xl p-3.5 mt-3 flex justify-between items-center border border-line" data-testid="rest">
          <div>
            <div className="text-[11px] tracking-wider text-muted uppercase">Rest</div>
            <div className="text-xs text-muted">Set {setNumber} starts when you lift</div>
          </div>
          <div className="font-serif text-[30px] tabular-nums">{setStartedAt ? clock(now - setStartedAt) : "—"}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        {([["left", m?.left_pct, LEFT, labels.left], ["right", m?.right_pct, RIGHT, labels.right]] as const).map(
          ([key, v, color, label]) => (
            <div key={key} className="flex flex-col items-center">
              <ActivationRing value={v ?? 0} color={color} size={128} />
              <div className="text-[11px] tracking-wider text-muted uppercase mt-2 text-center">{label}</div>
            </div>
          )
        )}
      </div>

      <div className="text-center mt-3" data-testid="reps">
        <div className="font-serif font-light text-[64px] leading-none tabular-nums">{reps}</div>
        <div className="text-xs text-muted mt-1">reps this set</div>
      </div>

      <div className="bg-surface rounded-2xl p-3.5 mt-4">
        <div className="flex justify-between items-baseline mb-2">
          <div className="text-[11px] tracking-wider text-muted uppercase">Balance</div>
          <div className="text-xs text-muted">{m?.imbalance_pct ?? 0}% imbalance</div>
        </div>
        <BalanceBar left={m?.left_avg_pct} right={m?.right_avg_pct} leftLabel={labels.left} rightLabel={labels.right} />
        <div className="grid grid-cols-2 gap-2 mt-3 text-center">
          <Metric label="Time under tension" value={`${tut}s`} />
          <Metric label="Peak activation" value={`${m?.peak_pct ?? 0}%`} />
        </div>
      </div>

      <div className="bg-deep rounded-2xl p-3 mt-3">
        <div className="flex justify-between text-[11px] tracking-wider text-muted uppercase mb-1">
          <span>Activation · last 10 s</span>
          <span className="normal-case tracking-normal"><span style={{ color: LEFT }}>● L</span> <span style={{ color: RIGHT }}>● R</span></span>
        </div>
        <ActivationChart points={pct.current} windowSec={10} height={84} empty="Waiting for signal…" />
      </div>

      {done.length > 0 && (
        <div className="mt-3" data-testid="done-sets">
          {done.map((s) => (
            <div key={s.set_number} className="flex justify-between text-sm py-1.5 border-b border-track last:border-0">
              <span className="text-soft">Set {s.set_number} ✓</span>
              <span className="text-muted">{s.reps ?? 0} reps · {Math.round(Number(s.time_under_tension_seconds ?? 0))}s</span>
            </div>
          ))}
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-1 mt-4 bg-gradient-to-t from-bg via-bg/95 to-transparent">
        {finishing ? (
          <Notice text="Finishing — the station is saving your sets…" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={props.onNextSet} className="h-14 rounded-full border border-line bg-surface text-[16px]">Next set</button>
              <button onClick={props.onFinish} className="h-14 rounded-full bg-accent text-bg text-[16px] font-semibold">Finish</button>
            </div>
            <button onClick={props.onCancel} className="text-xs text-muted mt-2 w-full">Cancel and delete this workout</button>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="font-serif text-xl">{value}</div>
      <div className="text-[10.5px] text-muted">{label}</div>
    </div>
  );
}

/** Sets the station has already saved for this workout (refetched when a set completes). */
function useCompletedSets(sessionId: string | null, completed: number): DoneSet[] {
  const [sets, setSets] = useState<DoneSet[]>([]);
  useEffect(() => {
    if (!sessionId || !supabase || completed === 0) {
      setSets([]);
      return;
    }
    let live = true;
    // The station saves the set right after "Next set"; give it a moment.
    const t = window.setTimeout(async () => {
      const { data } = await supabase!
        .from("sets")
        .select("set_number,reps,time_under_tension_seconds")
        .eq("session_id", sessionId)
        .order("set_number");
      if (live) setSets((data ?? []) as DoneSet[]);
    }, 800);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [sessionId, completed]);
  return sets;
}

// ---------------------------------------------------------------------------
function DoneView({ sessionId, onNew }: { sessionId: string; onNew: () => void }) {
  const [s, setS] = useState<SessionDetail | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadSession(sessionId).then((d) => live && setS(d), () => live && setS(null));
    return () => {
      live = false;
    };
  }, [sessionId]);

  if (s === undefined) return <Notice text="Loading your summary…" />;
  const sides = s ? sideShare(s) : null;
  return (
    <div className="flex flex-col gap-3" data-testid="summary">
      <div>
        <div className="text-[11px] tracking-wider text-muted uppercase">Workout saved ✓</div>
        <h2 className="font-serif font-light text-[22px]">{s?.exerciseName ?? "Workout"}</h2>
      </div>
      {s && (
        <div className="bg-surface rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <ActivationRing value={s.activationScore} color="#C8202F" size={96} />
            <div>
              <div className="text-[11px] tracking-wider text-muted uppercase">Activation score</div>
              <div className="font-serif text-[34px] leading-none">{s.activationScore}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <Metric label="Sets" value={s.sets.length} />
            <Metric label="Reps" value={s.totalReps} />
            <Metric label="Tension" value={`${s.totalTimeUnderTensionSec}s`} />
          </div>
          {sides && (
            <div className="mt-4">
              <BalanceBar left={sides.left} right={sides.right} leftLabel={sides.leftLabel} rightLabel={sides.rightLabel} />
            </div>
          )}
        </div>
      )}
      <Link to={`/session/${sessionId}`} className="flex items-center justify-center h-12 rounded-full bg-accent text-bg font-semibold">
        View session
      </Link>
      <button onClick={onNew} className="h-12 rounded-full border border-line">New workout</button>
    </div>
  );
}

function sideShare(s: SessionDetail) {
  const pick = (re: RegExp) => s.muscleActivations.find((a) => re.test(a.muscle));
  const l = pick(/^left\b/i);
  const r = pick(/^right\b/i);
  if (!l && !r) return null;
  return { left: l?.pct ?? 0, right: r?.pct ?? 0, leftLabel: l?.muscle ?? "Left", rightLabel: r?.muscle ?? "Right" };
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
export function ConnectCard({ onConnected, error }: { onConnected: () => void; error: string | null }) {
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

export function StationPill({ station }: { station: StationInfo }) {
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
export function EnvelopePlot({ samples, tick, left, right }: {
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
