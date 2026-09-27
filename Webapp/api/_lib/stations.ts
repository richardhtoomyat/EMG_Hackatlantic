import type { StationRow } from "./auth.js";
import { check, db } from "./db.js";
import { live } from "./live.js";

export const ONLINE_WITHIN_MS = 15_000; // station heartbeat every 5 s
export const IDLE_RELEASE_MS = 10 * 60_000; // user inactive this long → station freed

export type CommandType = "start" | "next_set" | "finish" | "cancel";

export const isOnline = (s: StationRow) => !!s.last_seen_at && Date.now() - Date.parse(s.last_seen_at) < ONLINE_WITHIN_MS;

export async function queueCommand(stationId: string, type: CommandType, payload: Record<string, unknown> = {}) {
  check(await db().from("station_commands").insert({ station_id: stationId, type, payload }), "queue command");
}

/** Delete a session and its sets (an unfinished workout is discarded, as agreed). */
export async function discardSession(sessionId: string) {
  check(await db().from("sets").delete().eq("session_id", sessionId), "discard sets");
  check(await db().from("sessions").delete().eq("id", sessionId), "discard session");
}

/**
 * Free the station for the next user. An unfinished recording is discarded and
 * the station is told to stop (cancel). Old undelivered commands are dropped.
 */
export async function releaseStation(station: StationRow, reason: string): Promise<StationRow> {
  check(
    await db().from("station_commands").delete().eq("station_id", station.id).is("delivered_at", null),
    "clear mailbox"
  );
  if (station.recording_session_id) {
    await discardSession(station.recording_session_id);
    await queueCommand(station.id, "cancel", { session_id: station.recording_session_id, reason });
  }
  const updated = check(
    await db()
      .from("stations")
      .update({ current_user_id: null, connected_at: null, last_activity_at: null, recording_session_id: null })
      .eq("id", station.id)
      .select("*")
      .single(),
    "release station"
  ) as StationRow;
  await live().clear(station.id).catch(() => {});
  return updated;
}

/** Frees the station if its user has been inactive for IDLE_RELEASE_MS. */
export async function releaseIfIdle(station: StationRow): Promise<StationRow> {
  if (
    station.current_user_id &&
    station.last_activity_at &&
    Date.now() - Date.parse(station.last_activity_at) > IDLE_RELEASE_MS
  ) {
    return releaseStation(station, "timeout");
  }
  return station;
}

export interface SetPayload {
  set_number: number;
  reps: number;
  time_under_tension_sec: number;
  peak_activation_pct: number;
  contraction_pct: number;
  recovery_sec: number;
  muscle_pct: Record<string, number>;
}

/** Insert or update one set of a session (keyed by session_id + set_number). */
export async function upsertSet(sessionId: string, s: SetPayload) {
  const row = {
    session_id: sessionId,
    set_number: s.set_number,
    reps: s.reps,
    time_under_tension_seconds: s.time_under_tension_sec,
    peak_activation: s.peak_activation_pct,
    contraction_pct: s.contraction_pct,
    recovery_seconds: s.recovery_sec,
    muscle_pct: s.muscle_pct,
  };
  const existing = check(
    await db().from("sets").select("id").eq("session_id", sessionId).eq("set_number", s.set_number).maybeSingle(),
    "find set"
  ) as { id: string } | null;
  if (existing) check(await db().from("sets").update(row).eq("id", existing.id), "update set");
  else check(await db().from("sets").insert(row), "insert set");
}
