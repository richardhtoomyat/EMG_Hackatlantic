interface ActivationRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}

/**
 * The core "muscle tension" ring used on Today / Live Workout screens.
 * Pure SVG, no dependency — ports directly to react-native-svg later
 * (same circle-with-dasharray technique).
 */
export default function ActivationRing({
  value,
  size = 140,
  strokeWidth = 14,
  color = "#7FB8C9",
  label,
  sublabel,
}: ActivationRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100);
  const center = size / 2;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#1E232B" strokeWidth={strokeWidth} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset .4s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="font-serif font-light leading-none" style={{ fontSize: size * 0.3 }}>
          {value}
        </span>
        {label && <span className="text-xs text-muted">{label}</span>}
        {sublabel && <span className="text-[13px]" style={{ color }}>{sublabel}</span>}
      </div>
    </div>
  );
}
