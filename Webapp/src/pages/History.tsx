import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { StatRows } from "../components/StatGrid";
import { useAppData, useDataSource } from "../data/dataContext";
import { HISTORY_PAGE, loadHistoryPage } from "../data/supabaseData";
import type { SessionHistoryItem } from "../data/types";

/** Every workout, newest first, grouped by day; tap one to open it. */
export default function History() {
  const { SESSION_HISTORY, WEEKLY_TRENDS, VIEWING, ATHLETE } = useAppData();
  const source = useDataSource();
  const { user } = useAuth();
  // Coaches see the athlete picked on the Coach screen; athletes see their own.
  const athleteId = VIEWING?.athleteId ?? (ATHLETE.role?.toLowerCase() === "coach" ? null : user?.id ?? null);

  const [items, setItems] = useState<SessionHistoryItem[]>(SESSION_HISTORY);
  const [more, setMore] = useState(SESSION_HISTORY.length >= HISTORY_PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The first page comes with the app data; reset when it changes (e.g. after a new workout).
  useEffect(() => {
    setItems(SESSION_HISTORY);
    setMore(source === "supabase" && SESSION_HISTORY.length >= HISTORY_PAGE);
  }, [SESSION_HISTORY, source]);

  const loadMore = async () => {
    if (!athleteId) return;
    setLoading(true);
    setError(null);
    try {
      const page = await loadHistoryPage(athleteId, items.length);
      setItems((prev) => [...prev, ...page.filter((p) => !prev.some((x) => x.id === p.id))]);
      setMore(page.length >= HISTORY_PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const groups = groupByDay(items);

  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px] mb-3">History</h2>

      <h3 className="text-[15px] font-medium text-soft mb-2.5">This Week</h3>
      <StatRows
        items={[
          { label: "Sessions", value: WEEKLY_TRENDS.sessionsCompleted },
          { label: "Best Session", value: WEEKLY_TRENDS.bestSessionScore, color: "#7FB8C9" },
          { label: "Avg Imbalance", value: `${WEEKLY_TRENDS.avgImbalancePct}%` },
        ]}
      />

      {items.length === 0 && (
        <div className="bg-surface rounded-2xl p-5 text-center text-sm text-muted mt-4">
          No workouts yet — record one on the Workout tab.
        </div>
      )}

      {groups.map(({ label, items: day }) => (
        <section key={label} className="mt-5" data-testid="history-day">
          <div className="text-[11px] tracking-wider text-muted uppercase mb-1.5">{label}</div>
          {day.map((item, i) => (
            <Link
              key={item.id ?? i}
              to={item.id ? `/session/${item.id}` : "/session"}
              className="bg-surface rounded-2xl p-3 my-1.5 flex justify-between items-center"
              data-testid="history-item"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">{item.exerciseName}</div>
                <div className="text-xs text-muted">
                  {[
                    item.timeLabel,
                    item.setCount != null ? `${item.setCount} ${item.setCount === 1 ? "set" : "sets"}` : null,
                    `${item.reps} reps`,
                    item.imbalancePct ? `${item.imbalancePct}% imbalance` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="font-serif font-light text-[26px] text-primaryMuscle">{item.score}</div>
                <span className="text-muted">›</span>
              </div>
            </Link>
          ))}
        </section>
      ))}

      {error && <div role="alert" className="text-sm text-max mt-3">{error}</div>}
      {more && athleteId && (
        <button onClick={() => void loadMore()} disabled={loading}
          className="h-11 rounded-full border border-line text-sm mt-4 disabled:opacity-60">
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

/** Today / Yesterday / "Wed, Sep 24" groups, newest first. */
function groupByDay(items: SessionHistoryItem[]) {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = key(new Date());
  const yesterday = key(new Date(Date.now() - 86_400_000));
  const groups: { label: string; items: SessionHistoryItem[] }[] = [];
  for (const item of items) {
    const label =
      item.date === today
        ? "Today"
        : item.date === yesterday
          ? "Yesterday"
          : new Date(item.date + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
