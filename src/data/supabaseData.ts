/**
 * Supabase-backed data layer. Produces the same AppData shape as the mock
 * exports in mockData.ts, so pages don't care where the numbers came from.
 * Table definitions live in supabase/schema.sql.
 */
import { ATHLETE_ID, supabase } from "../lib/supabase";
import type { AppData, DaySummary, LiveSet, Session, SessionHistoryItem } from "./types";

type SessionRow = {
  id: string;
  exercise_name: string;
  started_at: string;
  total_reps: number;
  workout_volume: number;
  total_tut_sec: number;
  avg_peak_activation_pct: number;
  avg_activation_pct: number;
  imbalance_pct: number;
  activation_score: number;
  coach_name: string | null;
  coach_message: string | null;
};

type LiveSetRow = {
  exercise_name: string;
  left_pct: number;
  right_pct: number;
  imbalance_pct: number;
  reps: number;
  tut_sec: number;
  peak_activation_pct: number;
  fatigue_label: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local-time YYYY-MM-DD (avoids UTC day shifts). */
function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function mapLiveSet(row: LiveSetRow): LiveSet {
  return {
    exerciseName: row.exercise_name,
    leftPct: row.left_pct,
    rightPct: row.right_pct,
    imbalancePct: row.imbalance_pct,
    reps: row.reps,
    timeUnderTension: mmss(row.tut_sec),
    peakActivationPct: row.peak_activation_pct,
    fatigueLabel: row.fatigue_label,
  };
}

async function resolveAthleteId(): Promise<string | null> {
  if (ATHLETE_ID) return ATHLETE_ID;
  const { data, error } = await supabase!
    .from("athletes")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Load everything from Supabase. Any piece that has no rows yet keeps its
 * value from `fallback` (the mock data), so a half-filled database still
 * renders a complete UI.
 */
export async function fetchAppData(fallback: AppData): Promise<{ data: AppData; athleteId: string } | null> {
  if (!supabase) return null;
  const athleteId = await resolveAthleteId();
  if (!athleteId) return null;

  const since = new Date(Date.now() - 14 * DAY_MS).toISOString();

  const [athleteRes, coachRes, readinessRes, sessionsRes, liveRes] = await Promise.all([
    supabase.from("athletes").select("*").eq("id", athleteId).single(),
    supabase
      .from("coach_links")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("linked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("readiness_snapshots")
      .select("score,label,description,recorded_at")
      .eq("athlete_id", athleteId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false }),
    supabase
      .from("sessions")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("started_at", { ascending: false })
      .limit(50),
    supabase.from("live_sets").select("*").eq("athlete_id", athleteId).maybeSingle(),
  ]);

  for (const r of [athleteRes, coachRes, readinessRes, sessionsRes, liveRes]) {
    if (r.error) throw r.error;
  }

  const data: AppData = { ...fallback };
  const a = athleteRes.data;
  data.ATHLETE = {
    name: a.name,
    email: a.email ?? "",
    heightLabel: a.height_label ?? "—",
    weightLabel: a.weight_label ?? "—",
    age: a.age ?? 0,
    sensorsConnected: a.sensors_connected,
  };

  if (coachRes.data) {
    data.COACH_LINK = {
      coachName: coachRes.data.coach_name,
      shareCode: coachRes.data.share_code,
      linkedSince: relativeDays(coachRes.data.linked_at),
    };
  }

  // Readiness: latest snapshot + week-over-week trend.
  const readiness = readinessRes.data ?? [];
  if (readiness.length > 0) {
    const latest = readiness[0];
    data.READINESS = { score: latest.score, label: latest.label, description: latest.description };
    const weekAgo = Date.now() - 7 * DAY_MS;
    const thisWeek = readiness.filter((r) => new Date(r.recorded_at).getTime() >= weekAgo).map((r) => r.score);
    const lastWeek = readiness.filter((r) => new Date(r.recorded_at).getTime() < weekAgo).map((r) => r.score);
    data.WEEKLY_READINESS_TREND_PCT =
      lastWeek.length > 0 && avg(lastWeek) > 0
        ? Math.round(((avg(thisWeek) - avg(lastWeek)) / avg(lastWeek)) * 100)
        : 0;
  }

  const live = liveRes.data as LiveSetRow | null;
  if (live) data.LIVE_SET = mapLiveSet(live);

  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  if (sessions.length > 0) {
    const today = isoDay(new Date());
    const dayOf = (s: SessionRow) => isoDay(new Date(s.started_at));

    data.SESSION_HISTORY = sessions.slice(0, 20).map<SessionHistoryItem>((s) => ({
      id: s.id,
      exerciseName: s.exercise_name,
      date: dayOf(s),
      dateLabel: new Date(s.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      reps: s.total_reps,
      score: s.activation_score,
    }));

    // Last 7 days, oldest → today.
    const week: DaySummary[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY_MS);
      const key = isoDay(d);
      const scores = sessions.filter((s) => dayOf(s) === key).map((s) => s.activation_score);
      week.push({
        label: d.toLocaleDateString("en-US", { weekday: "narrow" }),
        date: key,
        avgActivationScore: avg(scores),
        trained: scores.length > 0,
        isToday: i === 0,
      });
    }
    data.WEEK_SUMMARY = week;

    const weekStart = week[0].date;
    const thisWeek = sessions.filter((s) => dayOf(s) >= weekStart);
    data.WEEKLY_TRENDS = {
      avgImbalancePct: avg(thisWeek.map((s) => s.imbalance_pct)),
      bestSessionScore: Math.max(0, ...thisWeek.map((s) => s.activation_score)),
      sessionsCompleted: thisWeek.length,
    };

    const todays = sessions.filter((s) => dayOf(s) === today);
    data.TODAY_METRICS = {
      avgActivationPct: avg(todays.map((s) => s.avg_activation_pct)),
      bestImbalancePct: todays.length ? Math.min(...todays.map((s) => s.imbalance_pct)) : 0,
      totalVolumeReps: todays.reduce((n, s) => n + s.total_reps, 0),
      fatigueLabel: live?.fatigue_label ?? (todays.length ? fallback.TODAY_METRICS.fatigueLabel : "—"),
    };

    data.CURRENT_SESSION = await fetchSession(sessions[0]);
  }

  return { data, athleteId };
}

async function fetchSession(s: SessionRow): Promise<Session> {
  const [setsRes, actRes] = await Promise.all([
    supabase!.from("session_sets").select("*").eq("session_id", s.id).order("set_number"),
    supabase!.from("muscle_activations").select("muscle,pct").eq("session_id", s.id).order("pct", { ascending: false }),
  ]);
  if (setsRes.error) throw setsRes.error;
  if (actRes.error) throw actRes.error;

  return {
    id: s.id,
    exerciseName: s.exercise_name,
    date: isoDay(new Date(s.started_at)),
    timeLabel: new Date(s.started_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    sets: (setsRes.data ?? []).map((r) => ({
      setNumber: r.set_number,
      reps: r.reps,
      timeUnderTensionSec: r.tut_sec,
      peakActivationPct: r.peak_activation_pct,
      avgActivationPct: r.avg_activation_pct,
    })),
    totalReps: s.total_reps,
    workoutVolume: s.workout_volume,
    totalTimeUnderTensionSec: s.total_tut_sec,
    avgPeakActivationPct: s.avg_peak_activation_pct,
    imbalancePct: s.imbalance_pct,
    activationScore: s.activation_score,
    muscleActivations: actRes.data ?? [],
    coachNote:
      s.coach_name && s.coach_message ? { coachName: s.coach_name, message: s.coach_message } : undefined,
  };
}

/** Realtime: push live_sets updates (from the FastAPI hub) into the Workout screen. */
export function subscribeLiveSet(athleteId: string, onChange: (live: LiveSet) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`live_sets:${athleteId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "live_sets", filter: `athlete_id=eq.${athleteId}` },
      (payload) => {
        if (payload.new && "exercise_name" in payload.new) onChange(mapLiveSet(payload.new as LiveSetRow));
      }
    )
    .subscribe();
  return () => {
    supabase!.removeChannel(channel);
  };
}
