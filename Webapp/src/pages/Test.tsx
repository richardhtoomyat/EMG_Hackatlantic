import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { useRefreshData } from "../data/dataContext";
import { EXERCISES } from "../data/mockData";
import { saveSession } from "../data/saveSession";
import { generateTestSession } from "../data/testSession";
import { ConnectCard, EnvelopePlot, StationPill } from "../components/StationRecorder";
import { useStation, useStationMessages } from "../lib/useStation";
import { RecordingLab } from "./playback/Playback";
import { stationTransport } from "./playback/recorderTransport";

/**
 * Test tab: check the link to the sensor station. Shows the connection, the
 * sensors and the live signal, and every line typed in the station's
 * terminal (python src/station.py), live. Below that, Kiril's baseline /
 * strain recording, run on the connected station.
 */
export default function Test() {
  const { enabled, user } = useAuth();
  if (!enabled || !user) {
    return <Box>Sign in to connect to a sensor station.</Box>;
  }
  return <StationTest userId={user.id} />;
}

function StationTest({ userId }: { userId: string }) {
  const st = useStation(() => {});
  const transport = useMemo(() => stationTransport(userId), [userId]);
  const connectionKey = st.station ? `${st.station.id}:${st.station.connected_at ?? ""}` : null;
  const messages = useStationMessages(connectionKey);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages.length]);

  if (st.station === undefined) return <Box>Checking for a connected station…</Box>;
  if (st.station === null) {
    return (
      <>
        <ConnectCard onConnected={() => void st.refreshStation()} error={st.error} />
        <SaveTestSession />
      </>
    );
  }

  const m = st.metrics;
  const fmt = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
  return (
    <div className="flex-grow flex flex-col gap-3">
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="text-[11px] tracking-wider text-muted uppercase">Test</div>
          <h2 className="font-serif font-light text-[22px]">Station link</h2>
        </div>
        <StationPill station={st.station} />
      </div>

      <div className="bg-surface rounded-2xl p-3.5">
        <div className="flex justify-between items-center mb-2">
          <div className="text-[11px] tracking-wider text-muted uppercase">From the station terminal</div>
          <span className="text-[11px] text-muted" data-testid="message-count">{messages.length} lines</span>
        </div>
        <div
          ref={log}
          data-testid="terminal-log"
          className="bg-deep rounded-xl p-3 font-mono text-[13px] leading-relaxed h-56 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="text-muted">
              Type anything in the station's terminal and press Enter — it appears here.
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.seq} className="flex gap-2">
                <span className="text-muted shrink-0">
                  {new Date(msg.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="text-ink break-all whitespace-pre-wrap" data-testid="terminal-line">{msg.text}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <EnvelopePlot samples={st.samples} tick={st.sampleTick} left="Left" right="Right" />

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-deep rounded-2xl p-3">
          <div className="text-[11px] tracking-wider text-muted uppercase">Left now</div>
          <div className="font-serif text-2xl" style={{ color: "#D9B26A" }}>{fmt(m?.left_pct)}</div>
        </div>
        <div className="bg-deep rounded-2xl p-3">
          <div className="text-[11px] tracking-wider text-muted uppercase">Right now</div>
          <div className="font-serif text-2xl" style={{ color: "#7FB8C9" }}>{fmt(m?.right_pct)}</div>
        </div>
      </div>

      <div className="mt-2">
        <div className="text-[11px] tracking-wider text-muted uppercase">Baseline & strain</div>
        <h3 className="font-serif font-light text-[20px] mb-1">Muscle recording</h3>
        {!st.station.online && <Box>The station is offline — start <code>station.py</code> to record.</Box>}
        <RecordingLab transport={transport} />
      </div>

      {st.error && <div role="alert" className="text-sm text-max">{st.error}</div>}
      <button onClick={() => void st.disconnect()} className="h-11 rounded-full border border-line text-sm">
        Disconnect from {st.station.name}
      </button>
      <SaveTestSession />
    </div>
  );
}

function Box({ children }: { children: ReactNode }) {
  return <div className="bg-deep rounded-2xl p-3.5 text-sm text-muted" role="status">{children}</div>;
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
