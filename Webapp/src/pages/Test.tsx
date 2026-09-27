import { useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "../auth/authContext";
import { ConnectCard, EnvelopePlot, StationPill } from "../components/StationRecorder";
import { useStation, useStationMessages } from "../lib/useStation";

/**
 * Test tab: check the link to the sensor station. Shows the connection, the
 * sensors and the live signal, and every line typed in the station's
 * terminal (python src/station.py), live.
 */
export default function Test() {
  const { enabled, user } = useAuth();
  if (!enabled || !user) {
    return <Box>Sign in to connect to a sensor station.</Box>;
  }
  return <StationTest />;
}

function StationTest() {
  const st = useStation(() => {});
  const connectionKey = st.station ? `${st.station.id}:${st.station.connected_at ?? ""}` : null;
  const messages = useStationMessages(connectionKey);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages.length]);

  if (st.station === undefined) return <Box>Checking for a connected station…</Box>;
  if (st.station === null) return <ConnectCard onConnected={() => void st.refreshStation()} error={st.error} />;

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

      {st.error && <div role="alert" className="text-sm text-max">{st.error}</div>}
      <button onClick={() => void st.disconnect()} className="h-11 rounded-full border border-line text-sm">
        Disconnect from {st.station.name}
      </button>
    </div>
  );
}

function Box({ children }: { children: ReactNode }) {
  return <div className="bg-deep rounded-2xl p-3.5 text-sm text-muted" role="status">{children}</div>;
}
