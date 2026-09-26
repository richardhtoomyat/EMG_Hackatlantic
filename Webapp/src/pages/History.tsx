import { Link } from "react-router-dom";
import { StatRows } from "../components/StatGrid";
import { useAppData } from "../data/dataContext";

export default function History() {
  const { SESSION_HISTORY, WEEKLY_TRENDS } = useAppData();
  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px] mb-3">This Week</h2>

      {SESSION_HISTORY.map((item, i) => (
        <Link
          key={i}
          to="/session"
          className="bg-surface rounded-2xl p-3 my-2 flex justify-between items-center"
        >
          <div>
            <div className="text-[13px] font-medium">{item.exerciseName}</div>
            <div className="text-xs text-muted">
              {item.dateLabel} · {item.reps} reps
            </div>
          </div>
          <div className="font-serif font-light text-[26px] text-primaryMuscle">{item.score}</div>
        </Link>
      ))}

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Weekly Trends</h3>
      <StatRows
        items={[
          { label: "Avg Imbalance", value: `${WEEKLY_TRENDS.avgImbalancePct}%` },
          { label: "Best Session", value: WEEKLY_TRENDS.bestSessionScore, color: "#7FB8C9" },
          { label: "Sessions", value: WEEKLY_TRENDS.sessionsCompleted },
        ]}
      />
    </div>
  );
}
