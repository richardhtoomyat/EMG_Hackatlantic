/**
 * Body-metric rules: age from date of birth, and when to remind the user to
 * re-enter weight (every 20 days) and height (yearly while under 22).
 */
import type { AthleteProfile } from "../data/types";

export const WEIGHT_REMINDER_DAYS = 20;
export const HEIGHT_REMINDER_DAYS = 365;
export const HEIGHT_REMINDER_UNTIL_AGE = 22;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole years since `birthDate` (YYYY-MM-DD), counted in local time. */
export function ageFromBirthDate(birthDate: string, now = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

/** First-time setup needed: an athlete without height, weight or date of birth. */
export function needsBodyMetricsSetup(a: AthleteProfile): boolean {
  if (a.role?.toLowerCase() === "coach") return false;
  return !a.heightCm || !a.weightKg || !a.birthDate;
}

export interface BodyMetricReminders {
  weightDue: boolean;
  heightDue: boolean;
}

export function bodyMetricReminders(a: AthleteProfile, now = new Date()): BodyMetricReminders {
  if (a.role?.toLowerCase() === "coach" || needsBodyMetricsSetup(a)) return { weightDue: false, heightDue: false };
  const sinceWeight = daysSince(a.weightUpdatedAt, now);
  const sinceHeight = daysSince(a.heightUpdatedAt, now);
  const young = a.birthDate ? ageFromBirthDate(a.birthDate, now) < HEIGHT_REMINDER_UNTIL_AGE : false;
  return {
    weightDue: sinceWeight === null || sinceWeight >= WEIGHT_REMINDER_DAYS,
    heightDue: young && (sinceHeight === null || sinceHeight >= HEIGHT_REMINDER_DAYS),
  };
}

// ---- units -----------------------------------------------------------------
export const cmToFtIn = (cm: number) => {
  const totalIn = Math.round(cm / 2.54);
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 };
};
export const ftInToCm = (ft: number, inch: number) => Math.round((ft * 12 + inch) * 2.54 * 10) / 10;
export const kgToLb = (kg: number) => Math.round(kg * 2.20462 * 10) / 10;
export const lbToKg = (lb: number) => Math.round((lb / 2.20462) * 10) / 10;
