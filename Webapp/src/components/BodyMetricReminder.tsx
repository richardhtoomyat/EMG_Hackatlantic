import { Link } from "react-router-dom";
import { useAppData, useDataSource } from "../data/dataContext";
import { bodyMetricReminders, daysSince, HEIGHT_REMINDER_UNTIL_AGE } from "../lib/bodyMetrics";

/** In-app reminders: weight every 20 days, height yearly while under 22. */
export default function BodyMetricReminder() {
  const { ATHLETE } = useAppData();
  const source = useDataSource();
  if (source !== "supabase") return null;
  const { weightDue, heightDue } = bodyMetricReminders(ATHLETE);
  if (!weightDue && !heightDue) return null;

  const since = daysSince(ATHLETE.weightUpdatedAt);
  return (
    <div className="flex flex-col gap-2 mb-3" role="status">
      {weightDue && (
        <Reminder
          to="/body-metrics?focus=weight"
          title="Time for a weigh-in"
          text={since === null ? "Add today's weight to keep trends accurate." : `Last weight entered ${since} days ago.`}
        />
      )}
      {heightDue && (
        <Reminder
          to="/body-metrics?focus=height"
          title="Update your height"
          text={`Under ${HEIGHT_REMINDER_UNTIL_AGE}? Measure once a year while you're still growing.`}
        />
      )}
    </div>
  );
}

function Reminder({ to, title, text }: { to: string; title: string; text: string }) {
  return (
    <Link to={to} className="bg-surface border border-work/40 rounded-2xl p-3.5 flex items-center gap-3">
      <span className="w-2 h-2 rounded-full bg-work flex-shrink-0" />
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted">{text}</div>
      </div>
      <span className="text-work text-sm">Update →</span>
    </Link>
  );
}
