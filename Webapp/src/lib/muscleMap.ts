import { ALL_MUSCLE_IDS, EXERCISES } from "../data/mockData";
import type { MuscleId, MuscleMap, MuscleState } from "../data/types";

/**
 * Merge several exercises into one combined muscle map — the "Today"
 * body-map union. Strava-style rule: if a muscle was PRIMARY in any
 * exercise, it stays primary even if another exercise only used it as
 * secondary. Everything untouched stays "untargeted".
 */
export function mergeExercises(exerciseNames: string[]): MuscleMap {
  const state: MuscleMap = {};
  ALL_MUSCLE_IDS.forEach((id) => (state[id] = "untargeted"));

  exerciseNames.forEach((name) => {
    const ex = EXERCISES[name];
    if (!ex) return;
    ex.secondary.forEach((id) => {
      if (state[id] !== "primary") state[id] = "secondary";
    });
    ex.primary.forEach((id) => {
      state[id] = "primary";
    });
  });

  return state;
}

/** Build the muscle map for a single exercise (used on the Session screen). */
export function muscleMapForExercise(exerciseName: string): MuscleMap {
  return mergeExercises([exerciseName]);
}

/**
 * Convert a raw sensor activation percentage into a display state.
 * This is the seam where live per-muscle EMG data plugs in later:
 * once you have a real % per muscle, map it through this instead of
 * a hardcoded exercise definition.
 */
export function pctToState(pct: number): MuscleState {
  if (pct >= 55) return "primary";
  if (pct >= 20) return "secondary";
  return "untargeted";
}

export function buildMapFromPercentages(
  pctByMuscle: Partial<Record<MuscleId, number>>
): MuscleMap {
  const state: MuscleMap = {};
  ALL_MUSCLE_IDS.forEach((id) => {
    state[id] = pctToState(pctByMuscle[id] ?? 0);
  });
  return state;
}
