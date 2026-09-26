/**
 * Supabase-backed data layer. Reads the project's existing tables
 * (profiles, coach_links, sessions, sets) and maps them onto the same
 * AppData shape as the mock exports in mockData.ts, so pages don't care
 * where the numbers came from.
 *
 * Anything these tables don't store yet (readiness score, the live set in
 * progress) keeps its mock value from `fallback`.
 */
import { ALL_MUSCLE_IDS } from "./mockData";
import { buildMapFromPercentages } from "../lib/muscleMap";
import { ATHLETE_ID, supabase } from "../lib/supabase";
import type {
  AppData,
  DaySummary,
  MuscleActivation,
  MuscleId,
  MuscleMap,
  Session,
  SessionHistoryItem,
} from "./types";

type ProfileRow = {
  id: string;
  name: string | null;
  role: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  age: number | null;
  sensors_connected: boolean | null;
};

type SessionRow = {
  id: string;
  exercise_name: string;
  started_at: string;
  ended_at: string | null;
  activation_score: number | null;
  feedback: string | null;
  muscle_map: unknown;
};

type SetRow = {
  session_id: string;
  set_number: number;
  reps: number | null;
  time_under_tension_seconds: number | null;
  peak_activation: number | null;
  contraction_pct: number | null;
  recovery_seconds: number | null;
  muscle_pct: unknown;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MUSCLE_STATES = new Set(["primary", "secondary", "untargeted"]);
const MUSCLE_IDS = new Set<string>(ALL_MUSCLE_IDS);

/** Local-time YYYY-MM-DD (avoids UTC day shifts). */
function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function heightLabel(cm: number | null): string {
  if (!cm) return "—";
  const totalIn = Math.round(Number(cm) / 2.54);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}" (${Math.round(Number(cm))} cm)`;
}

function weightLabel(kg: number | null): string {
  if (!kg) return "—";
  return `${Math.round(Number(kg) * 2.20462)} lbs (${Math.round(Number(kg))} kg)`;
}

/** sets.muscle_pct → { "Left Bicep": 68, ... } (ignores non-numeric values). */
function musclePct(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === "number" || (typeof n === "string" && n.trim() !== "" && !isNaN(Number(n)))) {
      out[k] = Number(n);
    }
  }
  return out;
}

/** Average each muscle's % across a session's sets. */
function sessionMuscleActivations(sets: SetRow[]): MuscleActivation[] {
  const sums: Record<string, number[]> = {};
  for (const s of sets) {
    for (const [m, p] of Object.entries(musclePct(s.muscle_pct))) (sums[m] ??= []).push(p);
  }
  return Object.entries(sums)
    .map(([muscle, ps]) => ({ muscle, pct: avg(ps) }))
    .sort((a, b) => b.pct - a.pct);
}

/** L/R imbalance from muscle keys containing "left"/"right" (or ending -l / -r). */
function imbalancePct(acts: MuscleActivation[]): number {
  const side = (re: RegExp) => acts.filter((a) => re.test(a.muscle)).map((a) => a.pct);
  const left = avg(side(/left|-l$/i));
  const right = avg(side(/right|-r$/i));
  const hi = Math.max(left, right);
  return hi > 0 ? Math.round((Math.abs(left - right) / hi) * 100) : 0;
}

/**
 * sessions.muscle_map → body-map states. Accepts either
 * { "f-bicep-l": "primary", ... } or { "f-bicep-l": 68, ... } (percentages).
 */
function parseMuscleMap(v: unknown): MuscleMap | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const entries = Object.entries(v as Record<string, unknown>).filter(([k]) => MUSCLE_IDS.has(k));
  if (entries.length === 0) return undefined;
  if (entries.every(([, s]) => typeof s === "string" && MUSCLE_STATES.has(s))) {
    const map: MuscleMap = {};
    ALL_MUSCLE_IDS.forEach((id) => (map[id] = "untargeted"));
    for (const [k, s] of entries) map[k as MuscleId] = s as MuscleMap[MuscleId];
    return map;
  }
  return buildMapFromPercentages(musclePct(Object.fromEntries(entries)) as Partial<Record<MuscleId, number>>);
}

async function resolveAthlete(): Promise<ProfileRow | null> {
  const cols = "id,name,role,height_cm,weight_kg,age,sensors_connected";
  if (ATHLETE_ID) {
    const { data, error } = await supabase!.from("profiles").select(cols).eq("id", ATHLETE_ID).maybeSingle();
    if (error) throw error;
    return data;
  }
  // Prefer a profile with role "athlete"; otherwise the oldest profile.
  const athletes = await supabase!.from("profiles").select(cols).ilike("role", "athlete").order("created_at").limit(1);
  if (athletes.error) throw athletes.error;
  if (athletes.data.length > 0) return athletes.data[0];
  const any = await supabase!.from("profiles").select(cols).order("created_at").limit(1);
  if (any.error) throw any.error;
  return any.data[0] ?? null;
}

/**
 * Load everything from Supabase. Returns null (→ mock data) when Supabase
 * isn't configured or no profile is readable with the current key.
 */
export async function fetchAppData(fallback: AppData): Promise<AppData | null> {
  if (!supabase) return null;
  const profile = await resolveAthlete();
  if (!profile) {
    console.warn(
      "[activateMyo] Supabase connected but no readable rows in `profiles` — " +
        "the table is empty or RLS blocks the anon key. Showing mock data."
    );
    return null;
  }

  const [coachRes, sessionsRes] = await Promise.all([
    supabase
      .from("coach_links")
      .select("coach_id,share_code,linked_since")
      .eq("athlete_id", profile.id)
      .order("linked_since", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sessions")
      .select("id,exercise_name,started_at,ended_at,activation_score,feedback,muscle_map")
      .eq("athlete_id", profile.id)
      .order("started_at", { ascending: false })
      .limit(50),
  ]);
  if (coachRes.error) throw coachRes.error;
  if (sessionsRes.error) throw sessionsRes.error;

  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  const [coachProfileRes, setsRes] = await Promise.all([
    coachRes.data?.coach_id
      ? supabase.from("profiles").select("name").eq("id", coachRes.data.coach_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sessions.length
      ? supabase
          .from("sets")
          .select("session_id,set_number,reps,time_under_tension_seconds,peak_activation,contraction_pct,recovery_seconds,muscle_pct")
          .in("session_id", sessions.map((s) => s.id))
          .order("set_number")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (coachProfileRes.error) throw coachProfileRes.error;
  if (setsRes.error) throw setsRes.error;

  const data: AppData = { ...fallback };

  data.ATHLETE = {
    name: profile.name ?? "Athlete",
    email: "",
    heightLabel: heightLabel(profile.height_cm),
    weightLabel: weightLabel(profile.weight_kg),
    age: profile.age ?? 0,
    sensorsConnected: !!profile.sensors_connected,
  };

  const coachName = coachProfileRes.data?.name ?? "Your coach";
  if (coachRes.data) {
    data.COACH_LINK = {
      coachName,
      shareCode: coachRes.data.share_code,
      linkedSince: coachRes.data.linked_since ? relativeDays(coachRes.data.linked_since) : "—",
    };
  }

  const setsBySession: Record<string, SetRow[]> = {};
  for (const s of (setsRes.data ?? []) as SetRow[]) (setsBySession[s.session_id] ??= []).push(s);

  const full = sessions.map((s) => toSession(s, setsBySession[s.id] ?? [], coachName));
  const today = isoDay(new Date());

  data.SESSION_HISTORY = full.slice(0, 20).map<SessionHistoryItem>((s) => ({
    id: s.id,
    exerciseName: s.exerciseName,
    date: s.date,
    dateLabel: new Date(s.date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    reps: s.totalReps,
    score: s.activationScore,
  }));

  // Last 7 days, oldest → today.
  const week: DaySummary[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS);
    const key = isoDay(d);
    const scores = full.filter((s) => s.date === key).map((s) => s.activationScore);
    week.push({
      label: d.toLocaleDateString("en-US", { weekday: "narrow" }),
      date: key,
      avgActivationScore: avg(scores),
      trained: scores.length > 0,
      isToday: i === 0,
    });
  }
  data.WEEK_SUMMARY = week;

  const thisWeek = full.filter((s) => s.date >= week[0].date);
  data.WEEKLY_TRENDS = {
    avgImbalancePct: avg(thisWeek.map((s) => s.imbalancePct)),
    bestSessionScore: Math.max(0, ...thisWeek.map((s) => s.activationScore)),
    sessionsCompleted: thisWeek.length,
  };

  const todays = full.filter((s) => s.date === today);
  const todaysSets = todays.flatMap((s) => s.sets);
  data.TODAY_METRICS = {
    avgActivationPct: avg(todaysSets.map((s) => s.avgActivationPct)),
    bestImbalancePct: todays.length ? Math.min(...todays.map((s) => s.imbalancePct)) : 0,
    totalVolumeReps: todays.reduce((n, s) => n + s.totalReps, 0),
    fatigueLabel: "—", // not stored yet
  };

  if (full.length > 0) data.CURRENT_SESSION = full[0];

  return data;
}

function toSession(s: SessionRow, sets: SetRow[], coachName: string): Session {
  const started = new Date(s.started_at);
  const muscleActivations = sessionMuscleActivations(sets);
  const mapped = sets.map((r) => ({
    setNumber: r.set_number,
    reps: num(r.reps),
    timeUnderTensionSec: Math.round(num(r.time_under_tension_seconds)),
    peakActivationPct: Math.round(num(r.peak_activation)),
    avgActivationPct: Math.round(num(r.contraction_pct)),
  }));

  return {
    id: s.id,
    exerciseName: s.exercise_name,
    date: isoDay(started),
    timeLabel: started.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    sets: mapped,
    totalReps: mapped.reduce((n, r) => n + r.reps, 0),
    workoutVolume: 0, // no load/weight column yet
    totalTimeUnderTensionSec: mapped.reduce((n, r) => n + r.timeUnderTensionSec, 0),
    avgPeakActivationPct: avg(mapped.map((r) => r.peakActivationPct)),
    imbalancePct: imbalancePct(muscleActivations),
    activationScore: s.activation_score ?? 0,
    muscleActivations,
    muscleMap: parseMuscleMap(s.muscle_map),
    coachNote: s.feedback ? { coachName, message: s.feedback } : undefined,
  };
}
