/**
 * Two-way link between the web app and the Python bridge on the athlete's
 * laptop (EMG/app/src/bridge.py) over Supabase Realtime Broadcast.
 *
 * Channel: "myo:<pairing code>" — the code is shown by the bridge and entered
 * once on the Workout screen. Protocol (see bridge.py):
 *   web → bridge  start_session, next_set, finish_session, cancel_session, resend_summary
 *   bridge → web  status (every 2 s), session_started, live (5/s), set_complete,
 *                 session_complete, error
 * Database writes happen here, as the signed-in user: the session row when
 * recording starts, each set on set_complete, the final summary at the end.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  createSessionRow,
  deleteSessionRow,
  finalizeSession,
  insertSetRow,
  type BridgeSet,
  type BridgeSummary,
} from "../data/saveSession";
import { sideLabels } from "../data/testSession";
import { supabase } from "./supabase";

const CODE_KEY = "activatemyo.pairingCode";
const OFFLINE_AFTER_MS = 6000; // status arrives every 2 s
const ACK_TIMEOUT_MS = 8000;
const RETRY_MS = 2000;

export type Phase = "idle" | "starting" | "recording" | "finishing" | "saving" | "done" | "error";

export interface DeviceStatus {
  state: "idle" | "recording";
  session_id: string | null;
  set_number: number | null;
  sensors: { left: boolean; right: boolean };
}

export interface LiveData {
  set_number: number;
  left_pct: number | null; // current activation
  right_pct: number | null;
  left_avg_pct: number | null; // average while active in this set (drives the balance bar)
  right_avg_pct: number | null;
  imbalance_pct: number;
  reps: number;
  tut_sec: number;
  peak_pct: number;
  completed_sets: number;
}

/** Accepts "abcd-2345", "ABCD 2345", "abcd2345" → "ABCD2345" (null if invalid). */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(code) ? code : null;
}

export const prettyCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

function readCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

export function useSensorLink(athleteId: string | null, onSaved: () => Promise<void> | void) {
  const [code, setCodeState] = useState<string | null>(readCode);
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [lastSeen, setLastSeen] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exercise, setExercise] = useState<string | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [savedSets, setSavedSets] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const sessionRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const setIds = useRef(new Map<number, string>());
  const retryTimer = useRef<number | null>(null);
  const finalized = useRef(new Set<string>());
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const stopRetry = () => {
    if (retryTimer.current !== null) window.clearInterval(retryTimer.current);
    retryTimer.current = null;
  };
  const fail = (msg: string) => {
    stopRetry();
    setError(msg);
    go("error");
  };

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    void channelRef.current?.send({ type: "broadcast", event, payload });
  }, []);

  // Re-send a command every 2 s until the bridge acknowledges (or time runs out).
  const sendUntilAck = (event: string, payload: Record<string, unknown>, waitingFor: Phase, onTimeout: () => void) => {
    stopRetry();
    send(event, payload);
    const started = Date.now();
    retryTimer.current = window.setInterval(() => {
      if (phaseRef.current !== waitingFor) return stopRetry();
      if (Date.now() - started > ACK_TIMEOUT_MS) {
        stopRetry();
        onTimeout();
        return;
      }
      send(event === "finish_session" ? "resend_summary" : event, payload);
    }, RETRY_MS);
  };

  const setCode = (next: string | null) => {
    try {
      if (next) localStorage.setItem(CODE_KEY, next);
      else localStorage.removeItem(CODE_KEY);
    } catch {
      /* per-browser convenience only */
    }
    setDevice(null);
    setLastSeen(0);
    setCodeState(next);
  };

  // Subscribe to the pairing channel.
  useEffect(() => {
    if (!supabase || !code) return;
    const sb = supabase;
    const ch = sb.channel(`myo:${code}`, { config: { broadcast: { self: false } } });
    const mine = (p: { session_id?: string }) => !!p.session_id && p.session_id === sessionRef.current;

    ch.on("broadcast", { event: "status" }, ({ payload }) => {
      setDevice(payload as DeviceStatus);
      setLastSeen(Date.now());
    })
      .on("broadcast", { event: "session_started" }, ({ payload }) => {
        if (mine(payload) && phaseRef.current === "starting") {
          stopRetry();
          go("recording");
        }
      })
      .on("broadcast", { event: "live" }, ({ payload }) => {
        if (mine(payload)) setLive(payload as LiveData);
        setLastSeen(Date.now());
      })
      .on("broadcast", { event: "set_complete" }, ({ payload }) => {
        const p = payload as { session_id: string; kept: boolean; set: BridgeSet };
        if (!mine(p) || !p.kept || setIds.current.has(p.set.set_number)) return;
        const sid = p.session_id;
        insertSetRow(sid, p.set)
          .then((rowId) => {
            setIds.current.set(p.set.set_number, rowId);
            setSavedSets((xs) => [...xs, p.set.set_number]);
          })
          .catch((e) => setError(`Set ${p.set.set_number} not saved: ${e.message ?? e}`));
      })
      .on("broadcast", { event: "session_complete" }, ({ payload }) => {
        const summary = payload as BridgeSummary;
        if (!mine(summary) || finalized.current.has(summary.session_id)) return;
        finalized.current.add(summary.session_id);
        stopRetry();
        go("saving");
        finalizeSession(summary.session_id, summary, setIds.current)
          .then(async () => {
            setSavedSets([...setIds.current.keys()].sort((a, b) => a - b));
            await onSavedRef.current();
            go("done");
          })
          .catch((e) => {
            finalized.current.delete(summary.session_id);
            fail(`Couldn't save the session: ${e.message ?? e}`);
          });
      })
      .on("broadcast", { event: "error" }, ({ payload }) => {
        const p = payload as { session_id?: string; message: string };
        if (!p.session_id || mine(p)) fail(`Laptop: ${p.message}`);
      })
      .subscribe();
    channelRef.current = ch;
    return () => {
      channelRef.current = null;
      void sb.removeChannel(ch);
    };
  }, [code]);

  // Tick so "online" goes stale when heartbeats stop.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => stopRetry, []);

  const online = lastSeen > 0 && now - lastSeen < OFFLINE_AFTER_MS;

  const start = async (exerciseName: string) => {
    if (!athleteId) return;
    setError(null);
    setLive(null);
    setSavedSets([]);
    setIds.current = new Map();
    go("starting");
    let id: string;
    try {
      id = await createSessionRow(athleteId, exerciseName); // the row exists before any data arrives
    } catch (e) {
      return fail(`Couldn't create the session row: ${(e as { message?: string }).message ?? e}`);
    }
    sessionRef.current = id;
    setSessionId(id);
    setExercise(exerciseName);
    const { left, right } = sideLabels(exerciseName);
    sendUntilAck(
      "start_session",
      { session_id: id, exercise_name: exerciseName, left_label: left, right_label: right },
      "starting",
      () => {
        // Nothing was recorded: remove the empty row rather than leave it in History.
        void deleteSessionRow(id).catch(() => {});
        sessionRef.current = null;
        setSessionId(null);
        fail("The laptop didn't respond. Is bridge.py running with this pairing code?");
      }
    );
  };

  const nextSet = () => {
    if (sessionRef.current) send("next_set", { session_id: sessionRef.current });
  };

  const finish = () => {
    const id = sessionRef.current;
    if (!id) return;
    go("finishing");
    sendUntilAck("finish_session", { session_id: id }, "finishing", () =>
      fail("The laptop didn't send the summary. Sets saved so far are kept.")
    );
  };

  const cancel = async () => {
    const id = sessionRef.current;
    stopRetry();
    if (id) {
      send("cancel_session", { session_id: id });
      await deleteSessionRow(id).catch(() => {});
    }
    sessionRef.current = null;
    setSessionId(null);
    setLive(null);
    setSavedSets([]);
    setError(null);
    go("idle");
  };

  const reset = () => {
    sessionRef.current = null;
    setLive(null);
    setError(null);
    go("idle"); // the last session ID stays visible until the next start
  };

  return { code, setCode, online, device, phase, sessionId, exercise, live, savedSets, error, start, nextSet, finish, cancel, reset };
}
