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
