/**
 * Supabase-backed data layer. Reads the project's existing tables
 * (profiles, coach_links, sessions, sets) and maps them onto the same
 * AppData shape as the mock exports in mockData.ts, so pages don't care
 * where the numbers came from.
 *
 * Everything is scoped to the signed-in user: an athlete sees their own
 * sessions; a coach sees the athlete linked to them in coach_links. Anything
 * these tables don't store yet (readiness score, the live set in progress)
 * keeps its mock value.
 */
import { ALL_MUSCLE_IDS } from "./mockData";
import { ageFromBirthDate } from "../lib/bodyMetrics";
import { getViewedAthlete } from "./coachSharing";
import { buildMapFromPercentages } from "../lib/muscleMap";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
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
  // Added by supabase/signup_profiles.sql; may be absent on older schemas.
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
  // Added by supabase/body_metrics.sql.
  birth_date?: string | null;
  weight_updated_at?: string | null;
  height_updated_at?: string | null;
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


/** What a signed-in user sees before (or without) any rows: their identity, no workouts. */
export function emptyAppData(fallback: AppData, user: User): AppData {
  const week: DaySummary[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS);
    week.push({
      label: d.toLocaleDateString("en-US", { weekday: "narrow" }),
      date: isoDay(d),
      avgActivationScore: 0,
      trained: false,
      isToday: i === 0,
    });
  }
  // Google puts full_name/name and avatar_url/picture in user_metadata.
  const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;
  return {
    ...fallback,
    ATHLETE: {
      name: meta.full_name || meta.name || user.email?.split("@")[0] || "Athlete",
      email: user.email ?? "",
      avatarUrl: meta.avatar_url || meta.picture || undefined,
      heightLabel: "—",
      weightLabel: "—",
      age: 0,
      sensorsConnected: false,
    },
    COACH_LINK: null,
    WEEK_SUMMARY: week,
    TODAY_METRICS: { avgActivationPct: 0, bestImbalancePct: 0, totalVolumeReps: 0, fatigueLabel: "—" },
    CURRENT_SESSION: null,
    SESSION_HISTORY: [],
    WEEKLY_TRENDS: { avgImbalancePct: 0, bestSessionScore: 0, sessionsCompleted: 0 },
  };
}

/** Load the signed-in user's data from Supabase. */
export async function fetchAppData(fallback: AppData, user: User): Promise<AppData> {
  if (!supabase) return fallback;
  const data = emptyAppData(fallback, user);

  // select("*") so the optional first_name/last_name/avatar_url/email columns are read when present.
  const profileRes = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (profileRes.error) throw profileRes.error;
  const profile = profileRes.data as ProfileRow | null;
  if (!profile) console.warn(`[activateMyo] no profiles row for user ${user.id}`);

  // data.ATHLETE already holds the Google/user_metadata name + picture as fallbacks.
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  data.ATHLETE = {
    name: fullName || profile?.name || data.ATHLETE.name,
    email: profile?.email || user.email || "",
    avatarUrl: profile?.avatar_url || data.ATHLETE.avatarUrl,
    heightLabel: heightLabel(profile?.height_cm ?? null),
    weightLabel: weightLabel(profile?.weight_kg ?? null),
    // Derived from birth_date so it goes up every birthday; falls back to the stored age.
    age: profile?.birth_date ? ageFromBirthDate(profile.birth_date) : profile?.age ?? 0,
    sensorsConnected: !!profile?.sensors_connected,
    role: profile?.role ?? undefined,
    heightCm: profile?.height_cm != null ? Number(profile.height_cm) : null,
    weightKg: profile?.weight_kg != null ? Number(profile.weight_kg) : null,
    birthDate: profile?.birth_date ?? null,
    weightUpdatedAt: profile?.weight_updated_at ?? null,
    heightUpdatedAt: profile?.height_updated_at ?? null,
    // select("*") only returns birth_date once body_metrics.sql has run.
    bodyMetricsEnabled: !!profile && "birth_date" in profile,
    // Only asked once roles.sql has added role_selected_at (and a profile row exists).
    roleSelected: !profile || !("role_selected_at" in profile) || !!(profile as { role_selected_at?: string | null }).role_selected_at,
  };

  // Athletes see their own training; coaches see one of their linked athletes
  // (the one picked on the Coach screen, else the most recently linked).
  const isCoach = profile?.role?.toLowerCase() === "coach";
  const linksRes = await supabase
    .from("coach_links")
    .select("athlete_id,coach_id,share_code,linked_since")
    .eq(isCoach ? "coach_id" : "athlete_id", user.id)
    .order("linked_since", { ascending: false });
  if (linksRes.error) throw linksRes.error;
  const links = linksRes.data ?? [];
  const picked = isCoach ? getViewedAthlete() : null;
  const link = links.find((l) => l.athlete_id === picked) ?? links[0] ?? null;
  const athleteId = isCoach ? link?.athlete_id ?? null : user.id;

  const [coachProfileRes, sessionsRes, viewedRes] = await Promise.all([
    link?.coach_id
      ? supabase.from("profiles").select("name").eq("id", link.coach_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    athleteId
      ? supabase
          .from("sessions")
          .select("id,exercise_name,started_at,ended_at,activation_score,feedback,muscle_map")
          .eq("athlete_id", athleteId)
          .order("started_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    isCoach && athleteId
      ? supabase.from("profiles").select("*").eq("id", athleteId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (coachProfileRes.error) throw coachProfileRes.error;
  if (sessionsRes.error) throw sessionsRes.error;
  if (viewedRes.error) throw viewedRes.error;
  if (isCoach && athleteId) {
    const v = (viewedRes.data ?? {}) as Record<string, string | null>;
    const full = [v.first_name, v.last_name].filter(Boolean).join(" ");
    data.VIEWING = { athleteId, athleteName: full || v.name || "Athlete" };
  }

  const coachName = coachProfileRes.data?.name ?? "Your coach";
  if (link) {
    data.COACH_LINK = {
      coachName,
      shareCode: link.share_code,
      linkedSince: link.linked_since ? relativeDays(link.linked_since) : "—",
    };
  }

  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  if (sessions.length === 0) return data;

  const setsRes = await supabase
    .from("sets")
    .select("session_id,set_number,reps,time_under_tension_seconds,peak_activation,contraction_pct,recovery_seconds,muscle_pct")
    .in("session_id", sessions.map((s) => s.id))
    .order("set_number");
  if (setsRes.error) throw setsRes.error;

  const setsBySession: Record<string, SetRow[]> = {};
  for (const s of (setsRes.data ?? []) as SetRow[]) (setsBySession[s.session_id] ??= []).push(s);

  const full = sessions.map((s) => toSession(s, setsBySession[s.id] ?? [], coachName));
  const today = isoDay(new Date());

  data.SESSION_HISTORY = full.slice(0, HISTORY_PAGE).map(historyItem);

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

  data.CURRENT_SESSION = full[0];

  return data;
}

function historyItem(s: Session): SessionHistoryItem {
  return {
    id: s.id,
    exerciseName: s.exerciseName,
    date: s.date,
    dateLabel: new Date(s.date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    reps: s.totalReps,
    score: s.activationScore,
    timeLabel: s.timeLabel,
    setCount: s.sets.length,
    imbalancePct: s.imbalancePct,
  };
}

// ---------------------------------------------------------------------------
// History pages and single sessions (History tab → /session/:id)

export const HISTORY_PAGE = 20;
const SESSION_COLUMNS = "id,athlete_id,exercise_name,started_at,ended_at,activation_score,feedback,muscle_map";
const SET_COLUMNS =
  "session_id,set_number,reps,time_under_tension_seconds,peak_activation,contraction_pct,recovery_seconds,muscle_pct";

async function setsFor(ids: string[]): Promise<Record<string, SetRow[]>> {
  const by: Record<string, SetRow[]> = {};
  if (!supabase || ids.length === 0) return by;
  const { data, error } = await supabase.from("sets").select(SET_COLUMNS).in("session_id", ids).order("set_number");
  if (error) throw error;
  for (const s of (data ?? []) as SetRow[]) (by[s.session_id] ??= []).push(s);
  return by;
}

/** One page of an athlete's workouts, newest first (rows offset … offset+HISTORY_PAGE-1). */
export async function loadHistoryPage(athleteId: string, offset: number): Promise<SessionHistoryItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_COLUMNS)
    .eq("athlete_id", athleteId)
    .order("started_at", { ascending: false })
    .range(offset, offset + HISTORY_PAGE - 1);
  if (error) throw error;
  const rows = (data ?? []) as SessionRow[];
  const sets = await setsFor(rows.map((r) => r.id));
  return rows.map((r) => historyItem(toSession(r, sets[r.id] ?? [], "")));
}

/** [seconds into the set, left %, right %] — the saved activation curve of one set. */
export type TracePoint = [number, number | null, number | null];

export interface SessionDetail extends Session {
  startedAt: string;
  endedAt: string | null;
  /** Activation curve per set number (only for the athlete's own sessions). */
  traces: Record<number, TracePoint[]>;
}

/** A single workout with its sets, coach note and saved activation curves. */
export async function loadSession(id: string): Promise<SessionDetail | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("sessions").select(SESSION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as SessionRow & { athlete_id: string };
  const [sets, coachName, traces] = await Promise.all([setsFor([id]), coachNameFor(row.athlete_id), tracesFor(id)]);
  return {
    ...toSession(row, sets[id] ?? [], coachName),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    traces,
  };
}

async function coachNameFor(athleteId: string): Promise<string> {
  if (!supabase) return "Your coach";
  const link = await supabase
    .from("coach_links")
    .select("coach_id")
    .eq("athlete_id", athleteId)
    .not("coach_id", "is", null)
    .order("linked_since", { ascending: false })
    .limit(1);
  const coachId = link.data?.[0]?.coach_id as string | undefined;
  if (!coachId) return "Your coach";
  const p = await supabase.from("profiles").select("name,first_name,last_name").eq("id", coachId).maybeSingle();
  const v = (p.data ?? {}) as Record<string, string | null>;
  return [v.first_name, v.last_name].filter(Boolean).join(" ") || v.name || "Your coach";
}

/** The station's saved curves for this session: emg_recordings type 1, kind "workout_curves" (athlete-only). */
async function tracesFor(sessionId: string): Promise<Record<number, TracePoint[]>> {
  const out: Record<number, TracePoint[]> = {};
  if (!supabase) return out;
  const { data, error } = await supabase
    .from("emg_recordings")
    .select("raw_data")
    .eq("recording_type", 1)
    .eq("raw_data->>kind", "workout_curves")
    .eq("raw_data->>session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return out; // e.g. a coach viewing an athlete: not readable, no graphs
  const raw = data[0].raw_data as { sets?: { set_number?: unknown; points?: unknown }[] };
  for (const s of raw.sets ?? []) {
    if (typeof s.set_number === "number" && Array.isArray(s.points)) out[s.set_number] = s.points as TracePoint[];
  }
  return out;
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
    recoverySec: Math.round(num(r.recovery_seconds)),
    musclePct: musclePct(r.muscle_pct),
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
