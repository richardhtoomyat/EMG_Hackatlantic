import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { StatRows } from "../components/StatGrid";
import { listLinked, removeLink, setViewedAthlete, type LinkedPerson } from "../data/coachSharing";
import { useAppData, useRefreshData } from "../data/dataContext";
import { isCoach } from "../data/roles";
import { loadHistoryPage } from "../data/supabaseData";
import type { SessionHistoryItem } from "../data/types";
import { ageFromBirthDate } from "../lib/bodyMetrics";
import { supabase } from "../lib/supabase";

type AthleteProfileRow = {
  id: string;
  name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  age: number | null;
  birth_date?: string | null;
  weight_updated_at?: string | null;
};

type Detail = {
  link: LinkedPerson;
  profile: AthleteProfileRow | null;
  workouts: SessionHistoryItem[];
  calibration: { exercise: string; at: string } | null;
};

/**
 * Coach → one linked athlete (/athlete/:id): profile, body metrics, training
 * summary and recent workouts (each opens the full session). Only for coaches
 * with a coach_links row to this athlete; database policies enforce the same.
 */
export default function AthleteDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { ATHLETE, VIEWING } = useAppData();
  const refresh = useRefreshData();
  const navigate = useNavigate();
  const [d, setD] = useState<Detail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    setD(undefined);
    load(user.id, id)
      .then((r) => live && setD(r))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [user, id]);

  if (!isCoach(ATHLETE.role)) return <Message title="Coaches only" text="Athlete profiles are for coach accounts." />;
  if (error) return <Message title="Couldn't load this athlete" text={error} />;
  if (d === undefined) return <div className="bg-deep rounded-2xl p-3.5 text-sm text-muted" role="status">Loading athlete…</div>;
  if (d === null) return <Message title="No access" text="This athlete isn't linked to you. Ask them for a share code." />;

  const p = d.profile;
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.name || d.link.name;
  const age = p?.birth_date ? ageFromBirthDate(p.birth_date) : p?.age ?? null;
  const weekStart = Date.now() - 7 * 86_400_000;
  const week = d.workouts.filter((w) => new Date(w.date + "T12:00").getTime() >= weekStart);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const viewing = VIEWING?.athleteId === id;

  const openDashboard = async () => {
    setViewedAthlete(id);
    await refresh();
    navigate("/");
  };
  const remove = async () => {
    if (!window.confirm(`Stop following ${name}? You'll need a new share code to see their training again.`)) return;
    try {
      await removeLink(d.link.linkId);
      if (viewing) setViewedAthlete(null);
      await refresh();
      navigate("/coach", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex-grow flex flex-col" data-testid="athlete-detail">
      <Link to="/coach" className="text-xs text-accent mb-3">← Your athletes</Link>

      <div className="bg-surface rounded-2xl p-5 text-center">
        {p?.avatar_url ? (
          <img src={p.avatar_url} alt="" referrerPolicy="no-referrer" className="rounded-full mx-auto mb-3 object-cover" style={{ width: 64, height: 64 }} />
        ) : (
          <div className="rounded-full bg-deep mx-auto mb-3 flex items-center justify-center font-semibold" style={{ width: 64, height: 64 }}>
            {name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
          </div>
        )}
        <div className="text-lg font-medium" data-testid="athlete-name">{name}</div>
        {p?.email && <div className="text-[13px] text-muted">{p.email}</div>}
        <div className="text-xs text-muted mt-1">
          Linked {d.link.linkedSince ? new Date(d.link.linkedSince).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
        </div>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Body</h3>
      <StatRows
        items={[
          { label: "Age", value: age ? String(age) : "—" },
          { label: "Height", value: p?.height_cm ? `${Math.round(Number(p.height_cm))} cm` : "—" },
          { label: "Weight", value: p?.weight_kg ? `${Number(p.weight_kg)} kg` : "—" },
        ]}
      />

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Last 7 days</h3>
      <StatRows
        items={[
          { label: "Workouts", value: week.length },
          { label: "Total reps", value: week.reduce((n, w) => n + w.reps, 0) },
          { label: "Best score", value: week.length ? Math.max(...week.map((w) => w.score)) : "—", color: "#7FB8C9" },
          { label: "Avg imbalance", value: week.length ? `${avg(week.map((w) => w.imbalancePct ?? 0))}%` : "—" },
        ]}
      />
      {d.calibration && (
        <div className="text-xs text-muted mt-2 px-1">
          Last calibration: {d.calibration.exercise} · {new Date(d.calibration.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
      )}

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Recent workouts</h3>
      {d.workouts.length === 0 ? (
        <div className="bg-surface rounded-2xl p-4 text-sm text-muted">No workouts yet.</div>
      ) : (
        d.workouts.slice(0, 10).map((w) => (
          <Link key={w.id} to={`/session/${w.id}`} className="bg-surface rounded-2xl p-3 my-1 flex justify-between items-center" data-testid="athlete-workout">
            <div className="min-w-0">
              <div className="text-[13px] font-medium truncate">{w.exerciseName}</div>
              <div className="text-xs text-muted">
                {w.dateLabel} · {w.timeLabel} · {w.setCount ?? 0} sets · {w.reps} reps
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="font-serif font-light text-[24px] text-primaryMuscle">{w.score}</div>
              <span className="text-muted">›</span>
            </div>
          </Link>
        ))
      )}

      <button onClick={() => void openDashboard()} className="h-12 rounded-full bg-accent text-bg font-semibold mt-5">
        {viewing ? "Open their dashboard" : "View their dashboard"}
      </button>
      <p className="text-xs text-muted text-center mt-1.5">Today and History then show {name.split(" ")[0]}'s training.</p>
      {error && <div role="alert" className="text-sm text-max mt-3">{error}</div>}
      <button onClick={() => void remove()} className="text-xs text-max mt-4 self-center">Remove access to {name}</button>
    </div>
  );
}

async function load(coachId: string, athleteId: string): Promise<Detail | null> {
  if (!supabase) return null;
  const link = (await listLinked(coachId, true)).find((l) => l.personId === athleteId);
  if (!link) return null;
  const [profileRes, workouts, calRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", athleteId).maybeSingle(),
    loadHistoryPage(athleteId, 0),
    supabase
      .from("emg_recordings")
      .select("created_at, raw_data")
      .eq("user_id", athleteId)
      .eq("recording_type", 0)
      .eq("raw_data->>kind", "calibration")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (profileRes.error) throw profileRes.error;
  const cal = calRes.data?.[0] as { created_at: string; raw_data: { exercise?: string } } | undefined;
  return {
    link,
    profile: profileRes.data as AthleteProfileRow | null,
    workouts,
    calibration: cal ? { exercise: cal.raw_data.exercise ?? "Workout", at: cal.created_at } : null,
  };
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">{title}</h2>
      <p className="text-sm text-muted mt-2">{text}</p>
      <Link to="/coach" className="flex items-center justify-center h-12 rounded-full bg-accent text-bg font-semibold mt-5">
        Your athletes
      </Link>
    </div>
  );
}
