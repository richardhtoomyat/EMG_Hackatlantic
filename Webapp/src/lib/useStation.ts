/**
 * State of the signed-in user's connection to a shared sensor station:
 * connecting with a one-time QR code, the connected station, live data, and
 * the recording controls. Everything goes through /api/me/* (stationApi.ts);
 * the station saves the workout to this account via Vercel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { sideLabels } from "../data/testSession";
import { muscleMapForExercise } from "./muscleMap";
import {
  releaseStation,
  stationApi,
  StationApiError,
  type ConnectCode,
  type ConnectStatus,
  type LiveMetrics,
  type LiveSnapshot,
  type Sample,
  type StationInfo,
  type StationMessage,
} from "./stationApi";

const STATION_POLL_MS = 3000;
const LIVE_POLL_MS = 300;
const CODE_POLL_MS = 1500;
const FINISH_TIMEOUT_MS = 30_000;
export const PLOT_WINDOW_MS = 10_000;

export type Phase = "idle" | "starting" | "recording" | "finishing" | "done";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function useStation(onSaved: () => Promise<void> | void) {
  const [station, setStation] = useState<StationInfo | null | undefined>(undefined); // undefined = loading
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exercise, setExercise] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  /** Raw envelope for the plot; mutated in place, `sampleTick` bumps on change. */
  const samples = useRef<Sample[]>([]);
  const [sampleTick, setSampleTick] = useState(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const finishDeadline = useRef(0);
  const changedAt = useRef(0); // live replies to requests sent before this are stale
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // ------------------------------------------------------------ station poll
  const refreshStation = useCallback(async () => {
    try {
      const { station: s } = await stationApi<{ station: StationInfo | null }>("station");
      setStation(s);
      return s;
    } catch (err) {
      if (err instanceof StationApiError && err.status === 401) setStation(null);
      return undefined;
    }
  }, []);

  useEffect(() => {
    void refreshStation();
    const id = window.setInterval(() => void refreshStation(), STATION_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshStation]);

  // A recording already running (e.g. the page was reloaded): pick it up.
  useEffect(() => {
    if (station?.recording_session_id && phaseRef.current === "idle") {
      setSessionId(station.recording_session_id);
      setPhase("recording");
    }
  }, [station?.recording_session_id]);

  // ------------------------------------------------------------ live poll
  const connectedId = station?.id ?? null;
  useEffect(() => {
    if (!connectedId) {
      samples.current = [];
      setMetrics(null);
      return;
    }
    let since = 0;
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const sentAt = Date.now();
        const snap = await stationApi<LiveSnapshot>("live", { query: { since } });
        if (stopped) return;
        if (snap.chunks.length) {
          const buf = samples.current;
          for (const c of snap.chunks) for (const s of c.samples) buf.push(s);
          const newest = buf[buf.length - 1][0];
          const cut = buf.findIndex((s) => s[0] >= newest - PLOT_WINDOW_MS);
          if (cut > 0) buf.splice(0, cut);
          setSampleTick((n) => n + 1);
        }
        since = snap.seq;
        setMetrics(snap.metrics);
        // The station finished saving (recording cleared) or the recording was dropped.
        if (!snap.recording_session_id && sentAt > changedAt.current) {
          if (phaseRef.current === "finishing") {
            await onSavedRef.current();
            setPhase("done");
          } else if (phaseRef.current === "recording") {
            setError("The recording was discarded (cancelled, disconnected or timed out).");
            setPhase("idle");
            setSessionId(null);
          }
        } else if (phaseRef.current === "finishing" && Date.now() > finishDeadline.current) {
          setError("The station hasn't confirmed the save yet — is it still running?");
        }
      } catch (err) {
        if (err instanceof StationApiError && err.status === 409) void refreshStation(); // disconnected
      }
      if (!stopped) timer = window.setTimeout(tick, LIVE_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [connectedId, refreshStation]);

  // Lost the station (disconnected elsewhere, idle timeout): reset the recorder.
  useEffect(() => {
    if (station === null && (phaseRef.current === "recording" || phaseRef.current === "starting")) {
      setError("Disconnected from the station — the unfinished workout was discarded.");
      setPhase("idle");
      setSessionId(null);
    }
  }, [station]);

  // ------------------------------------------------------------ actions
  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    }
  }, []);

  const start = (exerciseName: string) =>
    run(async () => {
      setPhase("starting");
      setExercise(exerciseName);
      setSavedSessionId(null);
      const labels = sideLabels(exerciseName);
      try {
        const r = await stationApi<{ session_id: string }>("command", {
          body: {
            type: "start",
            exercise_name: exerciseName,
            left_label: labels.left,
            right_label: labels.right,
            muscle_map: muscleMapForExercise(exerciseName),
          },
        });
        changedAt.current = Date.now();
        setSessionId(r.session_id);
        setPhase("recording");
      } catch (err) {
        setPhase("idle");
        throw err;
      }
    });

  const nextSet = () => run(async () => void (await stationApi("command", { body: { type: "next_set" } })));

  const finish = () =>
    run(async () => {
      await stationApi("command", { body: { type: "finish" } });
      finishDeadline.current = Date.now() + FINISH_TIMEOUT_MS;
      setSavedSessionId(sessionId);
      setPhase("finishing");
    });

  const cancel = () =>
    run(async () => {
      await stationApi("command", { body: { type: "cancel" } });
      setPhase("idle");
      setSessionId(null);
    });

  const disconnect = () =>
    run(async () => {
      await releaseStation();
      setPhase("idle");
      setSessionId(null);
      setStation(null);
    });

  const reset = () => {
    setPhase("idle");
    setSessionId(null);
    setError(null);
  };

  return {
    station,
    phase,
    sessionId,
    savedSessionId,
    exercise,
    metrics,
    samples,
    sampleTick,
    error,
    refreshStation,
    start,
    nextSet,
    finish,
    cancel,
    disconnect,
    reset,
  };
}

// ---------------------------------------------------------------------------
/** A one-time connect code (QR) and whether a station has scanned it yet. */
export function useConnectCode(active: boolean, onConnected: () => void) {
  const [code, setCode] = useState<ConnectCode | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "waiting" | "expired" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const create = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      setCode(await stationApi<ConnectCode>("connect-code", { method: "POST", body: {} }));
      setStatus("waiting");
    } catch (err) {
      setError(message(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!active || status !== "waiting" || !code) return;
    const id = window.setInterval(async () => {
      setNow(Date.now());
      try {
        const r = await stationApi<ConnectStatus>("connect-status", { query: { code: code.code } });
        if (r.status === "connected") {
          setCode(null);
          setStatus("idle");
          onConnectedRef.current();
        } else if (r.status === "expired") {
          setStatus("expired");
        }
      } catch {
        /* keep waiting; a network blip shouldn't cancel the code */
      }
    }, CODE_POLL_MS);
    return () => window.clearInterval(id);
  }, [active, status, code]);

  const secondsLeft = code ? Math.max(0, Math.round((Date.parse(code.expires_at) - now) / 1000)) : 0;
  return { code, status, error, secondsLeft, create };
}

// ---------------------------------------------------------------------------
const MESSAGE_POLL_MS = 500;

/** Lines typed in the connected station's terminal, newest last. `connectionKey`
 *  changes on every new connection, which starts an empty log. */
export function useStationMessages(connectionKey: string | null) {
  const [messages, setMessages] = useState<StationMessage[]>([]);
  useEffect(() => {
    setMessages([]);
    if (!connectionKey) return;
    let since = 0;
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const r = await stationApi<{ messages: StationMessage[]; seq: number }>("messages", { query: { since } });
        if (stopped) return;
        if (r.seq < since) since = 0; // the station's log was reset
        if (r.messages.length) setMessages((prev) => [...prev, ...r.messages].slice(-200));
        since = Math.max(since, r.seq);
      } catch {
        /* disconnected or offline: the station poll handles it */
      }
      if (!stopped) timer = window.setTimeout(tick, MESSAGE_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [connectionKey]);
  return messages;
}
