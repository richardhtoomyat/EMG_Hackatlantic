const ITEMS = [
  { label: "Primary Muscles", color: "#C8202F" },
  { label: "Secondary Muscles", color: "#F0B429" },
  { label: "Untargeted Muscles", color: "#D8D8D8" },
];

export default function Legend() {
  return (
    <div className="flex gap-3.5 justify-center flex-wrap mt-2.5 mb-0.5">
      {ITEMS.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-gray-600">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
          {item.label}
        </div>
      ))}
    </div>
  );
}
