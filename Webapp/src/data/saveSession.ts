/**
 * Write side of the Supabase data layer: persist a finished workout as one
 * `sessions` row plus one `sets` row per set. Requires the insert policies
 * in supabase/write_access.sql (athletes may only write their own rows).
 */
import { muscleMapForExercise } from "../lib/muscleMap";
import { supabase } from "../lib/supabase";

export interface NewSet {
  reps: number;
  timeUnderTensionSec: number;
  peakActivationPct: number;
  /** Average activation during the set (read back as the set's avg activation). */
  contractionPct: number;
  recoverySec: number;
  /** Per-muscle activation, e.g. { "Left Bicep": 68, "Right Bicep": 54 } (drives L/R imbalance). */
  musclePct: Record<string, number>;
}

export interface NewSession {
  exerciseName: string;
  startedAt: Date;
  endedAt: Date;
  activationScore: number; // 0-100
  feedback?: string | null;
  sets: NewSet[];
}

/** Inserts the session and its sets; returns the new session id. */
export async function saveSession(athleteId: string, s: NewSession): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured");

  const { data: session, error } = await supabase
    .from("sessions")
    .insert({
      athlete_id: athleteId,
      exercise_name: s.exerciseName,
      started_at: s.startedAt.toISOString(),
      ended_at: s.endedAt.toISOString(),
      activation_score: Math.round(s.activationScore),
      feedback: s.feedback ?? null,
      muscle_map: muscleMapForExercise(s.exerciseName),
    })
    .select("id")
    .single();
  if (error) throw error;

  if (s.sets.length > 0) {
    const { error: setsError } = await supabase.from("sets").insert(
      s.sets.map((set, i) => ({
        session_id: session.id,
        set_number: i + 1,
        reps: set.reps,
        time_under_tension_seconds: set.timeUnderTensionSec,
        peak_activation: set.peakActivationPct,
        contraction_pct: set.contractionPct,
        recovery_seconds: set.recoverySec,
        muscle_pct: set.musclePct,
      }))
    );
    if (setsError) {
      // No transactions over REST: remove the half-written session so History stays consistent.
      // RLS turns a disallowed delete into "0 rows" rather than an error, so check what was removed.
      const { data: removed } = await supabase.from("sessions").delete().eq("id", session.id).select("id");
      if (!removed?.length) {
        throw new Error(
          `${setsError.message}. The session row ${session.id} was saved without sets and could not be ` +
            "removed automatically (run supabase/write_access.sql to allow it)."
        );
      }
      throw setsError;
    }
  }

  return session.id;
}

// ---------------------------------------------------------------------------
// Live recording (sensor bridge): the session row is created when recording
// starts, each set is saved as it completes, and the row is finalised with the
// bridge's summary at the end — so the data can be inspected in Supabase while
// the workout is still in progress.

/** A set as reported by the Python bridge (EMG/app/src/recorder.py). */
export interface BridgeSet {
  set_number: number;
  reps: number;
  time_under_tension_sec: number;
  peak_activation_pct: number;
  contraction_pct: number;
  recovery_sec: number;
  muscle_pct: Record<string, number>;
}

export interface BridgeSummary {
  session_id: string;
  exercise_name: string;
  started_at: string; // ISO
  ended_at: string; // ISO
  activation_score: number;
  sets: BridgeSet[];
}

const setRow = (sessionId: string, s: BridgeSet) => ({
  session_id: sessionId,
  set_number: s.set_number,
  reps: s.reps,
  time_under_tension_seconds: s.time_under_tension_sec,
  peak_activation: s.peak_activation_pct,
  contraction_pct: s.contraction_pct,
  recovery_seconds: s.recovery_sec,
  muscle_pct: s.muscle_pct,
});

/** Creates the sessions row when recording starts; its id is the recording's session ID. */
export async function createSessionRow(athleteId: string, exerciseName: string): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      athlete_id: athleteId,
      exercise_name: exerciseName,
      started_at: new Date().toISOString(),
      muscle_map: muscleMapForExercise(exerciseName),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Saves one completed set; returns the sets row id. */
export async function insertSetRow(sessionId: string, s: BridgeSet): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.from("sets").insert(setRow(sessionId, s)).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Writes the final summary: score and end time on the session, and every set
 * (updating the rows saved during recording — e.g. rest time is only known
 * once the next set starts — and inserting any that are missing).
 */
export async function finalizeSession(
  sessionId: string,
  summary: BridgeSummary,
  savedSetIds: Map<number, string>
): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase
    .from("sessions")
    .update({ ended_at: summary.ended_at, activation_score: summary.activation_score })
    .eq("id", sessionId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The session row could not be updated (run supabase/write_access.sql).");

  for (const s of summary.sets) {
    const rowId = savedSetIds.get(s.set_number);
    if (rowId) {
      const { error: e } = await supabase.from("sets").update(setRow(sessionId, s)).eq("id", rowId);
      if (e) throw e;
    } else {
      savedSetIds.set(s.set_number, await insertSetRow(sessionId, s));
    }
  }
}

/** Cancel: remove the session row and any sets saved so far. */
export async function deleteSessionRow(sessionId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("sets").delete().eq("session_id", sessionId);
  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw error;
}
