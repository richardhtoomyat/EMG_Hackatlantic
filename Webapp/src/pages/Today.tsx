
import { Link } from "react-router-dom";
import BodyMap from "../components/BodyMap";
import Legend from "../components/Legend";
import ScoreCard from "../components/ScoreCard";
import StatGrid from "../components/StatGrid";
import WeekBars from "../components/WeekBars";
import { MuscleStatList } from "../components/StatGrid";
import BodyMetricReminder from "../components/BodyMetricReminder";
import { useAppData } from "../data/dataContext";
import { mergeExercises } from "../lib/muscleMap";
import { isCoach } from "../data/roles";
import { muscleLabel } from "../data/testSession";
import type { MuscleId, TodayMuscles } from "../data/types";

export default function Today() {
  const { ATHLETE, READINESS, SESSION_HISTORY, TODAY_METRICS, TODAY_MUSCLES, VIEWING, WEEKLY_READINESS_TREND_PCT, WEEK_SUMMARY } =
    useAppData();
  const coach = isCoach(ATHLETE.role);
  const workoutsThisWeek = WEEK_SUMMARY.filter((d) => d.trained).length;
  const firstName = ATHLETE.name.split(" ")[0];
  const who = coach && VIEWING ? VIEWING.athleteName.split(" ")[0] : null; // coach viewing an athlete
  const trainedToday = TODAY_MUSCLES !== null;
  // Nothing trained today → an empty body map (no made-up muscles).
  const todayMuscles = TODAY_MUSCLES?.map ?? mergeExercises([]);
  const groups = TODAY_MUSCLES ? muscleGroups(TODAY_MUSCLES) : [];
  const trend = WEEKLY_READINESS_TREND_PCT;

  return (
    <div className="flex-grow flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-[11px] tracking-wider text-muted uppercase">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </div>
          <h1 className="font-serif font-light text-[27px] leading-tight">Good morning, {firstName}</h1>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface text-xs">
          <span className={`w-2 h-2 rounded-full ${ATHLETE.sensorsConnected ? "bg-accent" : "bg-muted"}`} />
          {ATHLETE.sensorsConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <BodyMetricReminder />

      {VIEWING && (
        <Link to="/coach" className="bg-surface rounded-2xl px-3.5 py-2.5 mb-3 flex justify-between items-center text-sm">
          <span>
            Viewing <b>{VIEWING.athleteName}</b>'s training
          </span>
          <span className="text-accent text-xs">Switch →</span>
        </Link>
      )}

      <Link to="/test" className="block bg-surface rounded-2xl p-3.5 my-2 text-sm text-accent font-semibold">
        Baseline and strain recordings
      </Link>

      {READINESS ? (
        <ScoreCard label="Readiness Score" score={READINESS.score} description={READINESS.description} />
      ) : (
        <div className="bg-surface rounded-2xl p-5 text-center my-2" data-testid="readiness-empty">
          <div className="text-xs text-muted">Readiness Score</div>
          <div className="font-serif font-light text-[40px] leading-none mt-2 text-soft">No score yet</div>
          <div className="text-sm text-soft mt-2">
            {who
              ? `${who} hasn't trained in the last two weeks — their score appears after their next workout.`
              : SESSION_HISTORY.length > 0
                ? "It's been a while — one workout brings your score back. Let's go!"
                : "Every champion starts with rep one. Finish your first workout to unlock your readiness score."}
          </div>
          {!coach && (
            <Link to="/workout" className="inline-flex items-center justify-center h-10 px-5 rounded-full bg-accent text-bg text-sm font-semibold mt-4">
              {SESSION_HISTORY.length > 0 ? "Start a workout" : "Start your first workout"}
            </Link>
          )}
        </div>
      )}

      <div className="bg-surface rounded-2xl p-3.5 my-2">
        <div className="flex justify-between items-center">
          <div className="text-[11px] tracking-wider text-muted uppercase">This Week</div>
          <div className="px-3 py-1.5 rounded-full bg-deep text-xs">{workoutsThisWeek} of 7 days trained</div>
        </div>
        <WeekBars days={WEEK_SUMMARY} />
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-track">
          <div className="flex flex-col gap-0.5">
            <span className="font-serif font-light text-2xl">{workoutsThisWeek}</span>
            <span className="text-[11px] text-muted">workouts this week</span>
          </div>
          <div className="flex flex-col gap-0.5 items-end" data-testid="week-trend">
            {trend === null ? (
              <>
                <span className="text-[13px] font-semibold text-soft">—</span>
                <span className="text-[11px] text-muted">
                  {workoutsThisWeek === 0 ? "no workouts this week yet" : "nothing last week to compare"}
                </span>
              </>
            ) : (
              <>
                <span className={`inline-flex items-center gap-1 text-[13px] font-semibold ${trend >= 0 ? "text-accent" : "text-max"}`}>
                  {trend > 0 ? "↑" : trend < 0 ? "↓" : "→"} {Math.abs(trend)}%
                </span>
                <span className="text-[11px] text-muted">avg score vs last week</span>
              </>
            )}
          </div>
        </div>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Muscles Worked Today</h3>
      <div className="bg-[#FAFAFA] rounded-2xl p-3.5 relative" data-testid="today-body">
        <BodyMap muscles={todayMuscles} className="w-full h-auto block" />
        {trainedToday ? (
          <Legend />
        ) : (
          <div className="text-center text-xs text-[#6B7280] mt-2">
            No workout yet today — the muscles {who ? `${who} trains` : "you train"} light up here.
          </div>
        )}
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Muscle Group Breakdown</h3>
      {groups.length > 0 ? (
        <MuscleStatList items={groups} />
      ) : (
        <div className="bg-surface rounded-2xl p-3.5 text-sm text-muted" data-testid="breakdown-empty">
          Nothing trained yet today.
        </div>
      )}

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Today's Metrics</h3>
      <StatGrid
        items={[
          { label: "Avg Activation", value: trainedToday ? `${TODAY_METRICS.avgActivationPct}%` : "—", color: "#7FB8C9" },
          { label: "Best Balance", value: trainedToday ? `${TODAY_METRICS.bestImbalancePct}% diff` : "—", color: "#7FB8C9" },
          { label: "Total Volume", value: trainedToday ? `${TODAY_METRICS.totalVolumeReps} reps` : "—", color: "#D9B26A" },
          { label: "Fatigue", value: TODAY_METRICS.fatigueLabel, color: "#7FB8C9" },
        ]}
      />

      <Link
        to={coach ? (VIEWING ? `/athlete/${VIEWING.athleteId}` : "/coach") : "/workout"}
        className="flex items-center justify-center h-12 rounded-full bg-accent text-bg font-semibold mt-5"
      >
        {coach ? (VIEWING ? `${VIEWING.athleteName.split(" ")[0]}'s profile` : "Your athletes") : "Start Workout"}
      </Link>
    </div>
  );
}

/**
 * Today's muscle groups (left/right merged, e.g. "Bicep"): primary first, then
 * secondary, with the average activation measured on that muscle today.
 */
function muscleGroups(t: TodayMuscles) {
  const groups = new Map<string, "primary" | "secondary">();
  for (const [id, state] of Object.entries(t.map)) {
    if (state !== "primary" && state !== "secondary") continue;
    const name = muscleLabel(id as MuscleId).replace(/^(Left|Right) /, "");
    if (state === "primary" || !groups.has(name)) groups.set(name, state);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] === "primary" ? -1 : 1))
    .map(([name, state]) => {
      const pcts = t.activations.filter((a) => a.muscle.replace(/^(Left|Right) /, "") === name).map((a) => a.pct);
      const pct = pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : null;
      const label = state === "primary" ? "Primary" : "Secondary";
      return {
        name,
        value: pct !== null ? `${pct}% · ${label}` : label,
        color: state === "primary" ? "#C8202F" : "#F0B429",
      };
    });
}
