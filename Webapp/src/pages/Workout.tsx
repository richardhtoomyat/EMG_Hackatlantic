import { Link } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import ActivationRing from "../components/ActivationRing";
import StationRecorder from "../components/StationRecorder";
import { StatRows } from "../components/StatGrid";
import { useAppData } from "../data/dataContext";
import { isCoach } from "../data/roles";

export default function Workout() {
  const { enabled, user } = useAuth();
  const { ATHLETE } = useAppData();
  if (enabled && user && isCoach(ATHLETE.role)) {
    return (
      <div className="flex-grow flex flex-col">
        <h2 className="font-serif font-light text-[22px]">Workouts are recorded by athletes</h2>
        <p className="text-sm text-muted mt-2">
          As a coach you see your athletes' workouts on their profiles, and on Today and History when viewing their dashboard.
        </p>
        <Link to="/coach" className="flex items-center justify-center h-12 rounded-full bg-accent text-bg font-semibold mt-5">
          Your athletes
        </Link>
      </div>
    );
  }
  if (enabled && user) {
    return (
      <StationRecorder />
    );
  }
  return <DemoWorkout />;
}

/** Demo mode (no Supabase): the original static live-set design with mock data. */
function DemoWorkout() {
  const { LIVE_SET } = useAppData();
  return (
    <div className="flex-grow flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-[11px] tracking-wider text-muted uppercase">Active Session</div>
          <h2 className="font-serif font-light text-[22px]">{LIVE_SET.exerciseName}</h2>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-max text-xs">
          <span className="w-2 h-2 rounded-full bg-max" />
          Live
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 my-4">
        <div className="text-center">
          <ActivationRing value={LIVE_SET.leftPct} color="#D9B26A" size={140} />
          <div className="text-[11px] tracking-wider text-muted uppercase mt-2">Left Bicep</div>
        </div>
        <div className="text-center">
          <ActivationRing value={LIVE_SET.rightPct} color="#7FB8C9" size={140} />
          <div className="text-[11px] tracking-wider text-muted uppercase mt-2">Right Bicep</div>
        </div>
      </div>

      <div className="bg-deep rounded-2xl p-3.5">
        <div className="flex justify-between items-center">
          <div className="text-[11px] tracking-wider text-muted uppercase">Imbalance</div>
          <div className="font-serif text-xl">{LIVE_SET.imbalancePct}%</div>
        </div>
        <div className="flex gap-[3px] h-2 mt-2">
          <div className="rounded flex-[55]" style={{ background: "#D9B26A" }} />
          <div className="rounded flex-[45]" style={{ background: "#7FB8C9" }} />
        </div>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Set Metrics</h3>
      <StatRows
        items={[
          { label: "Reps", value: LIVE_SET.reps },
          { label: "Time Under Tension", value: LIVE_SET.timeUnderTension },
          { label: "Peak Activation", value: `${LIVE_SET.peakActivationPct}%`, color: "#E07A5F" },
          { label: "Fatigue Level", value: LIVE_SET.fatigueLabel, color: "#D9B26A" },
        ]}
      />

      <Link
        to="/session"
        className="flex items-center justify-center h-12 rounded-full border border-line mt-5"
      >
        End Set
      </Link>

    </div>
  );
}
