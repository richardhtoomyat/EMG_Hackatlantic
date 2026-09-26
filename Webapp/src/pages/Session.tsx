import { Link } from "react-router-dom";
import BodyMap from "../components/BodyMap";
import Legend from "../components/Legend";
import ScoreCard from "../components/ScoreCard";
import { MuscleStatList, StatRows } from "../components/StatGrid";
import { useAppData } from "../data/dataContext";
import { muscleMapForExercise } from "../lib/muscleMap";

export default function Session() {
  const s = useAppData().CURRENT_SESSION;
  if (!s) {
    return (
      <div className="flex-grow flex flex-col">
        <h2 className="font-serif font-light text-[22px]">No sessions yet</h2>
        <p className="text-sm text-muted mt-2">Completed workouts will show up here.</p>
        <Link to="/" className="flex items-center justify-center h-12 rounded-full bg-accent text-bg font-semibold mt-5">
          Back to Today
        </Link>
      </div>
    );
  }
  const muscles = s.muscleMap ?? muscleMapForExercise(s.exerciseName);

  return (
    <div className="flex-grow flex flex-col">
      <div className="text-[11px] tracking-wider text-muted uppercase">
        {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {s.timeLabel}
      </div>
      <h2 className="font-serif font-light text-[22px] mt-1">
        {s.exerciseName} · {s.sets.length} Sets
      </h2>

      <ScoreCard label="Session Activation Score" score={s.activationScore} description="Excellent form and consistency" color="#C8202F" />

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Muscles Targeted</h3>
      <div className="bg-[#FAFAFA] rounded-2xl p-3.5">
        <BodyMap muscles={muscles} className="w-full h-auto block" />
        <Legend />
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Performance Metrics</h3>
      <StatRows
        items={[
          { label: "Total Reps", value: s.totalReps },
          {
            label: "Time Under Tension",
            value: `${Math.floor(s.totalTimeUnderTensionSec / 60)}:${String(s.totalTimeUnderTensionSec % 60).padStart(2, "0")}`,
          },
          { label: "Peak Activation", value: `${s.avgPeakActivationPct}%`, color: "#C8202F" },
          { label: "Muscle Balance", value: `${s.imbalancePct}% imbalance` },
        ]}
      />

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Activation by Muscle</h3>
      <MuscleStatList
        items={s.muscleActivations.map((m) => ({
          name: m.muscle,
          value: `${m.pct}%`,
          color: m.pct >= 55 ? "#C8202F" : "#F0B429",
        }))}
      />

      {s.coachNote && (
        <>
          <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Coach Feedback</h3>
          <div className="flex gap-2.5 p-3 bg-surface rounded-2xl items-center">
            <div className="w-8 h-8 rounded-full bg-deep flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {s.coachNote.coachName
                .split(" ")
                .map((w) => w[0])
                .join("")}
            </div>
            <div>
              <div className="text-xs text-muted">{s.coachNote.coachName} · during workout</div>
              <div className="text-sm mt-0.5">"{s.coachNote.message}"</div>
            </div>
          </div>
        </>
      )}

      <Link to="/" className="flex items-center justify-center h-12 rounded-full bg-accent text-bg font-semibold mt-5">
        Back to Today
      </Link>
    </div>
  );
}
