/**
 * Per-exercise calibration, once per login: relax (rest level) then squeeze as
 * hard as possible (max). During a calibrated workout the station maps each
 * side to % = (signal − rest) / (max − rest) × 100.
 *
 * Kept in this browser until logout (AuthProvider.signOut clears it), so the
 * first workout of an exercise after signing in asks for a calibration and
 * later ones reuse it. The station also saves each calibration to
 * emg_recordings (recording_type 0, kind "calibration").
 */
import { stationApi } from "./stationApi";
import { supabase } from "./supabase";

/** Exercises that must be calibrated before a workout (others use the adaptive scale). */
export const CALIBRATED_EXERCISES = ["Bicep Curl"];
export const RELAX_S = 5;
export const SQUEEZE_S = 5;

export type SideCalibration = { rest: number; mvc: number };
export type Calibration = { exercise: string; at: string; left?: SideCalibration; right?: SideCalibration };

/** What the station computed (lab.py summarize_calibration). */
export type CalibrationResult = {
  ok: boolean;
  exercise: string;
  sides: Record<"left" | "right", { sensor: string; ok: boolean; rest?: number; mvc?: number; mad?: number; problem?: string }>;
};

const PREFIX = "activatemyo:calibration:";
const key = (userId: string) => PREFIX + userId;

function readAll(userId: string): Record<string, Calibration> {
  try {
    return JSON.parse(localStorage.getItem(key(userId)) ?? "{}") as Record<string, Calibration>;
  } catch {
    return {};
  }
}

export const needsCalibration = (exercise: string) => CALIBRATED_EXERCISES.includes(exercise);

export function getCalibration(userId: string, exercise: string): Calibration | null {
  return readAll(userId)[exercise] ?? null;
}

export function saveCalibration(userId: string, result: CalibrationResult): Calibration {
  const side = (s: CalibrationResult["sides"]["left"]) =>
    s?.ok && s.rest != null && s.mvc != null ? { rest: s.rest, mvc: s.mvc } : undefined;
  const cal: Calibration = {
    exercise: result.exercise,
    at: new Date().toISOString(),
    left: side(result.sides.left),
    right: side(result.sides.right),
  };
  try {
    localStorage.setItem(key(userId), JSON.stringify({ ...readAll(userId), [result.exercise]: cal }));
  } catch {
    /* private mode: the calibration just lasts for this page */
  }
  return cal;
}

/** Logout: every exercise needs calibrating again. */
export function clearCalibrations() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- station steps
async function latestCalibrationId(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("emg_recordings")
    .select("id")
    .eq("user_id", userId)
    .eq("recording_type", 0)
    .eq("raw_data->>kind", "calibration")
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** Step 1: the station starts recording the relaxed signal. Returns a token for finish(). */
export async function startCalibration(userId: string, exercise: string): Promise<string | null> {
  const before = await latestCalibrationId(userId);
  await stationApi("command", { body: { type: "start", mode: "calibration", exercise } });
  return before;
}

/** Step 2: from now on the station treats the signal as the maximum squeeze. */
export const markSqueeze = () => stationApi("command", { body: { type: "next_set", mode: "calibration" } });

export const cancelCalibration = () => stationApi("command", { body: { type: "cancel", mode: "calibration" } });

/** Step 3: the station computes rest / max and saves them; wait for that row. */
export async function finishCalibration(userId: string, before: string | null): Promise<CalibrationResult> {
  await stationApi("command", { body: { type: "finish", mode: "calibration" } });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && supabase) {
    await new Promise((r) => setTimeout(r, 700));
    const { data } = await supabase
      .from("emg_recordings")
      .select("id, raw_data")
      .eq("user_id", userId)
      .eq("recording_type", 0)
      .eq("raw_data->>kind", "calibration")
      .order("created_at", { ascending: false })
      .limit(1);
    const row = data?.[0];
    if (row && row.id !== before) return row.raw_data as CalibrationResult;
  }
  throw new Error("The station didn't finish the calibration — is it still running?");
}
