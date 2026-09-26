/**
 * ============================================================================
 * MOCK DATA — replace this file's contents with real data later.
 * ============================================================================
 *
 * Every value below is hardcoded so the whole app runs and looks finished
 * without any sensor, backend, or auth hooked up. Nothing else in the app
 * (components/, pages/) knows or cares that this data is fake — they just
 * import the named exports from this file.
 *
 * When the LibEMG pipeline + FastAPI hub + Supabase backend are ready, swap
 * this file for one that:
 *   - exposes the SAME exported names and shapes (see data/types.ts)
 *   - fetches from your API / Supabase / WebSocket instead of returning
 *     literals
 *
 * Nothing downstream needs to change.
 * ============================================================================
 */

import type {
  AthleteProfile,
  CoachLink,
  DaySummary,
  ExerciseDefinition,
  MuscleId,
  ReadinessSnapshot,
  Session,
} from "./types";

export const ATHLETE: AthleteProfile = {
  name: "Alex Kim",
  email: "alex@activatemyo.io",
  heightLabel: "5'10\" (178 cm)",
  weightLabel: "175 lbs (79 kg)",
  age: 28,
  sensorsConnected: true,
};

export const COACH_LINK: CoachLink = {
  coachName: "Coach Maya",
  linkedSince: "3 days ago",
  shareCode: "A9K2M7",
};

export const READINESS: ReadinessSnapshot = {
  score: 82,
  label: "Recovered",
  description: "Recovered. Good day to activate.",
};

/** All muscle groups the body-map SVG can color. Used to build "union" states. */
export const ALL_MUSCLE_IDS: MuscleId[] = [
  "f-traps-l", "f-traps-r", "f-delt-l", "f-delt-r", "f-pec-l", "f-pec-r",
  "f-bicep-l", "f-bicep-r", "f-forearm-l", "f-forearm-r", "f-abs",
  "f-oblique-l", "f-oblique-r", "f-quad-l", "f-quad-r",
  "b-traps", "b-delt-l", "b-delt-r", "b-lat-l", "b-lat-r",
  "b-tricep-l", "b-tricep-r", "b-forearm-l", "b-forearm-r", "b-lowerback",
  "b-ham-l", "b-ham-r", "b-glute-l", "b-glute-r", "b-calf-l", "b-calf-r",
];

/**
 * Exercise → muscle recruitment map, Strava "Muscle Map" style:
 * primary muscles get full credit, secondary get half credit.
 * Extend this as you add exercises to the picker.
 */
export const EXERCISES: Record<string, ExerciseDefinition> = {
  "Bicep Curl": {
    name: "Bicep Curl",
    primary: ["f-bicep-l", "f-bicep-r"],
    secondary: ["f-forearm-l", "f-forearm-r", "f-delt-l", "f-delt-r"],
  },
  Squat: {
    name: "Squat",
    primary: ["f-quad-l", "f-quad-r", "b-glute-l", "b-glute-r"],
    secondary: ["b-ham-l", "b-ham-r", "f-abs", "b-lowerback"],
  },
  "Shoulder Press": {
    name: "Shoulder Press",
    primary: ["f-delt-l", "f-delt-r"],
    secondary: ["b-tricep-l", "b-tricep-r", "f-traps-l", "f-traps-r", "b-traps"],
  },
  Deadlift: {
    name: "Deadlift",
    primary: ["b-glute-l", "b-glute-r", "b-ham-l", "b-ham-r", "b-lowerback"],
    secondary: ["f-quad-l", "f-quad-r", "b-traps", "f-forearm-l", "f-forearm-r"],
  },
  "Pull-Up": {
    name: "Pull-Up",
    primary: ["b-lat-l", "b-lat-r"],
    secondary: ["f-bicep-l", "f-bicep-r", "b-traps", "f-forearm-l", "f-forearm-r"],
  },
  "Tricep Dips": {
    name: "Tricep Dips",
    primary: ["b-tricep-l", "b-tricep-r"],
    secondary: ["f-pec-l", "f-pec-r", "f-delt-l", "f-delt-r"],
  },
};

/** The "This Week" training-consistency rollup shown on the Today screen. */
export const WEEK_SUMMARY: DaySummary[] = [
  { label: "S", date: "2026-09-20", avgActivationScore: 0, trained: false },
  { label: "M", date: "2026-09-21", avgActivationScore: 58, trained: true },
  { label: "T", date: "2026-09-22", avgActivationScore: 0, trained: false },
  { label: "W", date: "2026-09-23", avgActivationScore: 71, trained: true },
  { label: "T", date: "2026-09-24", avgActivationScore: 64, trained: true },
  { label: "F", date: "2026-09-25", avgActivationScore: 0, trained: false },
  { label: "S", date: "2026-09-26", avgActivationScore: 78, trained: true, isToday: true },
];

export const WEEKLY_READINESS_TREND_PCT = 6; // "+6% vs last week"

/** Today's aggregate metrics (across all of today's sessions). */
export const TODAY_METRICS = {
  avgActivationPct: 62,
  bestImbalancePct: 12,
  totalVolumeReps: 84,
  fatigueLabel: "Mild",
};

/** The session currently open on the "Session Summary" screen. */
export const CURRENT_SESSION: Session = {
  id: "sess-2026-09-26-1",
  exerciseName: "Bicep Curl",
  date: "2026-09-26",
  timeLabel: "2:14 PM",
  sets: [
    { setNumber: 1, reps: 8, timeUnderTensionSec: 134, peakActivationPct: 84, avgActivationPct: 68 },
    { setNumber: 2, reps: 8, timeUnderTensionSec: 148, peakActivationPct: 89, avgActivationPct: 72 },
    { setNumber: 3, reps: 8, timeUnderTensionSec: 130, peakActivationPct: 81, avgActivationPct: 64 },
  ],
  totalReps: 24,
  workoutVolume: 1872,
  totalTimeUnderTensionSec: 402,
  avgPeakActivationPct: 86,
  imbalancePct: 18,
  activationScore: 78,
  muscleActivations: [
    { muscle: "Left Bicep", pct: 68 },
    { muscle: "Right Bicep", pct: 54 },
    { muscle: "Shoulders", pct: 26 },
    { muscle: "Forearms", pct: 31 },
  ],
  coachNote: {
    coachName: "Coach Maya",
    message: "Good form on sets 1–2. Keep core tight on set 3.",
  },
};

/** Live-workout screen numbers (the set currently in progress). */
export const LIVE_SET = {
  exerciseName: "Bicep Curl",
  leftPct: 68,
  rightPct: 54,
  imbalancePct: 20,
  reps: 8,
  timeUnderTension: "2:14",
  peakActivationPct: 89,
  fatigueLabel: "Moderate",
};

/** Past sessions for the History screen. */
export const SESSION_HISTORY: Array<{
  exerciseName: string;
  dateLabel: string;
  reps: number;
  score: number;
}> = [
  { exerciseName: "Bicep Curl", dateLabel: "Sep 26", reps: 24, score: 78 },
  { exerciseName: "Squat", dateLabel: "Sep 25", reps: 18, score: 72 },
  { exerciseName: "Shoulder Press", dateLabel: "Sep 24", reps: 20, score: 81 },
];

export const WEEKLY_TRENDS = {
  avgImbalancePct: 20,
  bestSessionScore: 81,
  sessionsCompleted: 5,
};
