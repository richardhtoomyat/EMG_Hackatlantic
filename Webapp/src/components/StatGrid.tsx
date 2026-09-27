export interface StatItem {
  label: string;
  value: string | number;
  color?: string;
}

export default function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item, i) => (
        // An odd last tile spans the full row instead of leaving a gap.
        <div key={item.label} className={`bg-surface rounded-2xl p-3 ${items.length % 2 === 1 && i === items.length - 1 ? "col-span-2" : ""}`}>
          <div className="text-[11px] text-muted">{item.label}</div>
          <div className="font-serif font-light text-[26px] mt-1" style={{ color: item.color ?? "#ECEAE4" }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatRows({ items }: { items: StatItem[] }) {
  return (
    <div className="bg-deep rounded-2xl px-3.5">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex justify-between items-center py-2.5 ${i < items.length - 1 ? "border-b border-track" : ""}`}
        >
          <span className="text-[13px] text-muted">{item.label}</span>
          <span className="font-serif font-light text-xl" style={{ color: item.color ?? "#ECEAE4" }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MuscleStatList({ items }: { items: { name: string; value: string; color: string }[] }) {
  return (
    <div className="bg-deep rounded-2xl px-3.5">
      {items.map((item, i) => (
        <div
          key={item.name}
          className={`flex justify-between items-center py-2.5 ${i < items.length - 1 ? "border-b border-track" : ""}`}
        >
          <span className="text-[13px] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
            {item.name}
          </span>
          <span className="font-serif font-light text-[17px]" style={{ color: item.color }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
