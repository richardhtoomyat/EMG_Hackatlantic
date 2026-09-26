import type { DaySummary } from "../data/types";

interface WeekBarsProps {
  days: DaySummary[];
}

/**
 * "This Week" training-consistency chart. Deliberately NOT a mood
 * check-in — every bar height is a measured average activation score
 * from that day's sessions, not a self-reported feeling.
 */
export default function WeekBars({ days }: WeekBarsProps) {
  const max = Math.max(...days.map((d) => d.avgActivationScore), 1);

  return (
    <div className="flex items-end justify-between gap-[7px] h-[68px] mt-1 mb-0.5">
      {days.map((d, i) => {
        const pct = d.isToday ? 22 : Math.max(10, Math.round((d.avgActivationScore / max) * 100));
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
            <div className="w-full flex-grow flex items-end">
              <div
                className="w-full rounded"
                style={{
                  height: `${pct}%`,
                  minHeight: 4,
                  background: d.isToday ? "#262C35" : d.trained ? "#7FB8C9" : "#1E232B",
                  border: d.isToday ? "1.5px dashed #9AA0A8" : undefined,
                }}
              />
            </div>
            <div className={`text-[10px] ${d.isToday ? "text-ink font-semibold" : "text-muted"}`}>
              {d.isToday ? "•" : d.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
