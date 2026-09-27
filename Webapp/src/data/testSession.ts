/**
 * Generates a realistic-looking finished workout for an exercise, so the
 * insert path (saveSession) can be exercised before the EMG sensor streams
 * real data. Numbers are random within plausible ranges.
 */
import { EXERCISES } from "./mockData";
import type { MuscleId } from "./types";
import type { NewSession } from "./saveSession";

const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

const REGION: Record<string, string> = {
  traps: "Traps", delt: "Delt", pec: "Pec", bicep: "Bicep", forearm: "Forearm", abs: "Abs",
  oblique: "Oblique", quad: "Quad", lat: "Lat", tricep: "Tricep", lowerback: "Lower Back",
  ham: "Hamstring", glute: "Glute", calf: "Calf",
};

/** "f-bicep-l" → "Left Bicep", "b-lowerback" → "Lower Back". */
export function muscleLabel(id: MuscleId): string {
  const [, region, side] = id.split("-");
  const name = REGION[region] ?? region;
  return side === "l" ? `Left ${name}` : side === "r" ? `Right ${name}` : name;
}

/**
 * The two sensors sit on the left and right side of the exercise's main muscle
 * (the first left/right pair in its primary list), e.g. Squat → quads.
 */
export function sideLabels(exerciseName: string): { left: string; right: string } {
  const primary = EXERCISES[exerciseName]?.primary ?? [];
  const leftId = primary.find((id) => id.endsWith("-l"));
  const rightId = leftId ? (leftId.replace(/-l$/, "-r") as MuscleId) : undefined;
  if (!leftId || !rightId || !primary.includes(rightId)) return { left: "Left", right: "Right" };
  return { left: muscleLabel(leftId), right: muscleLabel(rightId) };
}

export function generateTestSession(exerciseName: string, now = new Date()): NewSession {
  const ex = EXERCISES[exerciseName];
  if (!ex) throw new Error(`Unknown exercise: ${exerciseName}`);

  const setCount = rand(2, 4);
  const imbalance = rand(4, 25) / 100; // one side works harder, like a real L/R difference
  const strongLeft = Math.random() < 0.5;
  const sets = Array.from({ length: setCount }, (_, i) => {
    const fatigue = i * rand(1, 4); // later sets activate a little less
    const base = rand(62, 78) - fatigue;
    const musclePct: Record<string, number> = {};
    for (const id of ex.primary) {
      const weaker = id.endsWith(strongLeft ? "-r" : "-l");
      musclePct[muscleLabel(id)] = Math.round(weaker ? base * (1 - imbalance) : base);
    }
    for (const id of ex.secondary) musclePct[muscleLabel(id)] = rand(18, 38);
    const reps = rand(6, 12);
    return {
      reps,
      timeUnderTensionSec: reps * rand(3, 5) + rand(0, 10),
      peakActivationPct: Math.min(100, base + rand(12, 22)),
      contractionPct: base,
      recoverySec: i === setCount - 1 ? 0 : rand(60, 120),
      musclePct,
    };
  });

  const totalSec = sets.reduce((n, s) => n + s.timeUnderTensionSec + s.recoverySec, 0);
  return {
    exerciseName,
    startedAt: new Date(now.getTime() - totalSec * 1000),
    endedAt: now,
    activationScore: Math.round(sets.reduce((n, s) => n + s.contractionPct, 0) / setCount) + rand(5, 15),
    feedback: null,
    sets,
  };
}
