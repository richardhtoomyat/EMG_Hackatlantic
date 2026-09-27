import type { ReactNode } from "react";

export const LEFT_COLOR = "#D9B26A";
export const RIGHT_COLOR = "#7FB8C9";

/** [seconds, left %, right %] — null where a sensor had no reading. */
export type ActivationPoint = [number, number | null, number | null];

type Props = {
  points: ActivationPoint[];
  /** Show only the last `windowSec` seconds (live view); otherwise the whole range. */
  windowSec?: number;
  height?: number;
  /** Time axis labels (start / end), e.g. for a saved set. */
  axis?: boolean;
  empty?: ReactNode;
};

/**
 * Left / right muscle activation (0-100 %) over time as two lines — the live
 * view on the Workout screen and each set's saved curve on the Session page.
 */
export default function ActivationChart({ points, windowSec, height = 96, axis = false, empty }: Props) {
  const W = 300;
  const H = 100;
  const end = points.length ? points[points.length - 1][0] : 0;
  const start = windowSec != null ? end - windowSec : points.length ? points[0][0] : 0;
  const shown = windowSec != null ? points.filter((p) => p[0] >= start) : points;
  const span = Math.max(end - start, 0.001);
  const x = (t: number) => ((t - start) / span) * W;
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

  const path = (i: 1 | 2) => {
    let d = "";
    let pen = false;
    for (const p of shown) {
      const v = p[i];
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p[0]).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    }
    return d;
  };

  if (shown.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-muted" style={{ height }}>
        {empty ?? "No activation data"}
      </div>
    );
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full block" style={{ height }} role="img"
        aria-label="Left and right activation over time">
        {[25, 50, 75].map((g) => (
          <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="currentColor" className="text-track" strokeWidth={0.6}
            vectorEffect="non-scaling-stroke" />
        ))}
        <path d={path(1)} fill="none" stroke={LEFT_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={path(2)} fill="none" stroke={RIGHT_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {axis && (
        <div className="flex justify-between text-[10px] text-muted mt-1">
          <span>0s</span>
          <span>{Math.round(span)}s</span>
        </div>
      )}
    </div>
  );
}

/** Left vs right share of the work as one split bar, e.g. L 55 / R 45. */
export function BalanceBar({ left, right, leftLabel = "L", rightLabel = "R" }: {
  left: number | null | undefined;
  right: number | null | undefined;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const l = Math.max(0, left ?? 0);
  const r = Math.max(0, right ?? 0);
  const total = l + r;
  const lShare = total > 0 ? Math.round((l / total) * 100) : 50;
  return (
    <div>
      <div className="flex gap-[3px] h-2.5">
        <div className="rounded-l-full" style={{ flex: Math.max(lShare, 1), background: LEFT_COLOR }} />
        <div className="rounded-r-full" style={{ flex: Math.max(100 - lShare, 1), background: RIGHT_COLOR }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted mt-1">
        <span>{leftLabel} {total > 0 ? `${lShare}%` : "—"}</span>
        <span>{rightLabel} {total > 0 ? `${100 - lShare}%` : "—"}</span>
      </div>
    </div>
  );
}
