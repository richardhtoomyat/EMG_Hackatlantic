import { useAppData } from "../data/dataContext";

export default function Coach() {
  const { COACH_LINK } = useAppData();
  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">Coach Access</h2>

      <div className="text-[11px] tracking-wider text-muted uppercase mt-4 mb-3">Share Code</div>
      <div className="bg-deep rounded-2xl p-5 text-center">
        <div className="font-mono text-[34px] tracking-[4px] font-semibold text-accent my-3">
          {COACH_LINK.shareCode}
        </div>
        <div className="text-xs text-muted">Share this code with your coach</div>
        <button
          className="mt-3 h-11 px-4 rounded-full border border-line inline-flex items-center gap-2"
          onClick={() => navigator.clipboard?.writeText(COACH_LINK.shareCode).catch(() => {})}
        >
          📋 Copy Code
        </button>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Coaches with Access</h3>
      <div className="bg-surface rounded-2xl p-3.5 flex justify-between items-center">
        <div>
          <div className="font-medium">{COACH_LINK.coachName}</div>
          <div className="text-xs text-muted">Linked {COACH_LINK.linkedSince}</div>
        </div>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">What They Can See</h3>
      <div className="bg-deep rounded-2xl px-3.5">
        <div className="py-2 border-b border-track">✓ Live workouts</div>
        <div className="py-2 border-b border-track">✓ All metrics &amp; muscle map</div>
        <div className="py-2">✓ Send feedback</div>
      </div>
    </div>
  );
}
