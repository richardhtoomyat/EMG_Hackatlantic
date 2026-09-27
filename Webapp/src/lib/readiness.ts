/**
 * Readiness (Today screen): recent performance adjusted for recovery.
 *
 *   readiness = performance + rest + load, clipped to 0-100
 *
 *   performance  average activation score of the last (up to) 3 workouts in
 *                the past 14 days — none → no score yet (null)
 *   rest         time since the last workout ended:
 *                  < 12 h −15 · 12-24 h −5 · 1-2 rest days +5 (ideal)
 *                  · 3-6 days 0 · 7+ days −10 (long break)
 *   load         time under tension in the last 7 days vs the average week of
 *                the 3 weeks before: > 1.5× −10 (heavy week) · 1.2-1.5× −5
 *                · < 0.8× +3 (light week) · otherwise 0 (normal);
 *                0 while there are fewer than 3 earlier weeks of workouts
 */

export interface ReadinessWorkout {
  startedAt: string; // ISO
  endedAt: string | null; // ISO
  score: number; // activation score 0-100
  tutSec: number; // total time under tension
}

export interface ReadinessResult {
  score: number;
  label: string; // "Ready to push" | "Good to go" | "Take it easier"
  performance: number;
  workouts: number; // how many workouts the performance is based on
  rest: { points: number; text: string };
  load: { points: number; text: string };
}

const H = 3_600_000;
const DAY = 24 * H;
const WINDOW_DAYS = 14;
const LAST_N = 3;

const round = (x: number) => Math.round(x);
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

export function restAdjustment(hoursSince: number): { points: number; text: string } {
  const days = Math.floor(hoursSince / 24);
  if (hoursSince < 12) return { points: -15, text: `trained ${Math.max(1, round(hoursSince))} h ago` };
  if (hoursSince < 24) return { points: -5, text: `trained ${round(hoursSince)} h ago` };
  if (days <= 2) return { points: 5, text: `${days} rest day${days === 1 ? "" : "s"}` };
  if (days <= 6) return { points: 0, text: `${days} rest days` };
  return { points: -10, text: `long break (${days} days)` };
}

export function loadAdjustment(workouts: ReadinessWorkout[], now: number): { points: number; text: string } {
  const at = (w: ReadinessWorkout) => Date.parse(w.startedAt);
  const thisWeek = workouts.filter((w) => at(w) > now - 7 * DAY).reduce((n, w) => n + w.tutSec, 0);
  const earlier = workouts.filter((w) => at(w) <= now - 7 * DAY && at(w) > now - 28 * DAY);
  // Need workouts spread over the 3 earlier weeks to know what "usual" is.
  const weeksWithData = new Set(earlier.map((w) => Math.floor((now - at(w)) / (7 * DAY)))).size;
  if (weeksWithData < 3) return { points: 0, text: "building baseline" };
  const usual = earlier.reduce((n, w) => n + w.tutSec, 0) / 3;
  if (usual <= 0) return { points: 0, text: "building baseline" };
  const ratio = thisWeek / usual;
  if (ratio > 1.5) return { points: -10, text: "heavy week" };
  if (ratio > 1.2) return { points: -5, text: "load above usual" };
  if (ratio < 0.8) return { points: 3, text: "light week" };
  return { points: 0, text: "load normal" };
}

/** null when there is no workout in the last 14 days ("No score yet"). */
export function computeReadiness(workouts: ReadinessWorkout[], now = Date.now()): ReadinessResult | null {
  const sorted = [...workouts].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const recent = sorted.filter((w) => Date.parse(w.startedAt) > now - WINDOW_DAYS * DAY).slice(0, LAST_N);
  if (recent.length === 0) return null;
  const performance = round(recent.reduce((n, w) => n + w.score, 0) / recent.length);
  const last = sorted[0];
  const lastEnd = Date.parse(last.endedAt ?? last.startedAt);
  const rest = restAdjustment(Math.max(0, (now - lastEnd) / H));
  const load = loadAdjustment(sorted, now);
  const score = Math.max(0, Math.min(100, performance + rest.points + load.points));
  const label = score >= 80 ? "Ready to push" : score >= 60 ? "Good to go" : "Take it easier";
  return { score, label, performance, workouts: recent.length, rest, load };
}

/** "Good to go · last 3 workouts 72 · 1 rest day +5 · load normal" */
export function readinessDescription(r: ReadinessResult): string {
  const parts = [
    `last ${r.workouts === 1 ? "workout" : `${r.workouts} workouts`} ${r.performance}`,
    `${r.rest.text} ${signed(r.rest.points)}`,
    r.load.points ? `${r.load.text} ${signed(r.load.points)}` : r.load.text,
  ];
  return `${r.label} · ${parts.join(" · ")}`;
}
