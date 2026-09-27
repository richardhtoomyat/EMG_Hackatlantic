/**
 * Shared types for activateMyo.
 *
 * Everything in `mockData.ts` conforms to these shapes. When real sensor
 * data comes online, the plan is:
 *   1. Replace the hardcoded exports in mockData.ts with functions that
 *      hit your API / Supabase / WebSocket (same shapes, same names).
 *   2. Nothing in components/ or pages/ needs to change, since they only
 *      import from `data/mockData.ts` (or whatever you rename it to,
 *      e.g. `data/liveData.ts`) and never construct this data themselves.
 */

export type MuscleState = "primary" | "secondary" | "untargeted";

/** One entry per colorable region in the body-map SVG (see BodyMap.tsx). */
export type MuscleId =
  | "f-traps-l" | "f-traps-r"
  | "f-delt-l" | "f-delt-r"
  | "f-pec-l" | "f-pec-r"
  | "f-bicep-l" | "f-bicep-r"
  | "f-forearm-l" | "f-forearm-r"
  | "f-abs"
  | "f-oblique-l" | "f-oblique-r"
  | "f-quad-l" | "f-quad-r"
  | "b-traps"
  | "b-delt-l" | "b-delt-r"
  | "b-lat-l" | "b-lat-r"
  | "b-tricep-l" | "b-tricep-r"
  | "b-forearm-l" | "b-forearm-r"
  | "b-lowerback"
  | "b-ham-l" | "b-ham-r"
  | "b-glute-l" | "b-glute-r"
  | "b-calf-l" | "b-calf-r";

export type MuscleMap = Partial<Record<MuscleId, MuscleState>>;

/** An exercise's primary/secondary muscle recruitment (Strava-style weighting). */
export interface ExerciseDefinition {
  name: string;
  primary: MuscleId[];
  secondary: MuscleId[];
}

/** A single completed set within a session. */
export interface SetRecord {
  setNumber: number;
  reps: number;
  timeUnderTensionSec: number;
  peakActivationPct: number;
  avgActivationPct: number;
  /** Rest before the next set (seconds), when recorded. */
  recoverySec?: number;
  /** Per-muscle average activation in this set, e.g. { "Left Bicep": 68, "Right Bicep": 55 }. */
  musclePct?: Record<string, number>;
}

/** Per-muscle activation percentage recorded for a session (drives L/R imbalance). */
export interface MuscleActivation {
  muscle: string; // display label, e.g. "Left Bicep"
  pct: number;
}

/** A full logged workout session. */
export interface Session {
  id: string;
  exerciseName: string;
  date: string; // ISO date
  timeLabel: string; // "2:14 PM"
  sets: SetRecord[];
  totalReps: number;
  workoutVolume: number;
  totalTimeUnderTensionSec: number;
  avgPeakActivationPct: number;
  imbalancePct: number;
  activationScore: number; // 0-100 KPI
  muscleActivations: MuscleActivation[];
  /** Body-map states recorded for this session; falls back to the exercise definition. */
  muscleMap?: MuscleMap;
  coachNote?: { coachName: string; message: string };
}

/** One day's rollup for the "This Week" training-consistency chart. */
export interface DaySummary {
  label: string; // single-letter weekday label
  date: string; // ISO date
  avgActivationScore: number; // 0 if rest day
  trained: boolean;
  isToday?: boolean;
}

export interface AthleteProfile {
  name: string;
  email: string;
  /** Profile picture URL (e.g. from Google). */
  avatarUrl?: string;
  role?: string;
  /** Raw body metrics (Supabase only); labels above are for display. */
  heightCm?: number | null;
  weightKg?: number | null;
  birthDate?: string | null; // YYYY-MM-DD
  weightUpdatedAt?: string | null; // ISO timestamp
  heightUpdatedAt?: string | null;
  /** False until supabase/body_metrics.sql has added the columns (setup/reminders stay off). */
  bodyMetricsEnabled?: boolean;
  /** False until the user has chosen athlete / coach (supabase/roles.sql); Google sign-ups choose after sign-in. */
  roleSelected?: boolean;
  heightLabel: string;
  weightLabel: string;
  age: number;
  sensorsConnected: boolean;
}

export interface CoachLink {
  coachName: string;
  linkedSince: string;
  shareCode: string;
}

export interface ReadinessSnapshot {
  score: number; // 0-100
  label: string; // "Recovered", "Fatigued", etc.
  description: string;
}

/** One row in the History list. */
export interface SessionHistoryItem {
  id: string;
  exerciseName: string;
  date: string; // ISO date
  dateLabel: string; // "Sep 26"
  reps: number;
  score: number;
  timeLabel?: string; // "2:14 PM"
  setCount?: number;
  imbalancePct?: number;
}

/** Today's aggregate metrics (across all of today's sessions). */
export interface TodayMetrics {
  avgActivationPct: number;
  bestImbalancePct: number;
  totalVolumeReps: number;
  fatigueLabel: string;
}

/** The set currently in progress (Workout screen). */
export interface LiveSet {
  exerciseName: string;
  leftPct: number;
  rightPct: number;
  imbalancePct: number;
  reps: number;
  timeUnderTension: string; // "2:14"
  peakActivationPct: number;
  fatigueLabel: string;
}

export interface WeeklyTrends {
  avgImbalancePct: number;
  bestSessionScore: number;
  sessionsCompleted: number;
}

/** Everything the pages read, bundled — provided by data/DataProvider.tsx. */
export interface AppData {
  ATHLETE: AthleteProfile;
  COACH_LINK: CoachLink | null;
  READINESS: ReadinessSnapshot;
  WEEK_SUMMARY: DaySummary[];
  WEEKLY_READINESS_TREND_PCT: number;
  TODAY_METRICS: TodayMetrics;
  CURRENT_SESSION: Session | null;
  LIVE_SET: LiveSet;
  SESSION_HISTORY: SessionHistoryItem[];
  WEEKLY_TRENDS: WeeklyTrends;
  /** Coaches: the athlete whose training is shown (null for athletes / demo). */
  VIEWING: { athleteId: string; athleteName: string } | null;
}
