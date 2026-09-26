interface ScoreCardProps {
  label: string;
  score: number;
  description: string;
  color?: string;
}

export default function ScoreCard({ label, score, description, color = "#ECEAE4" }: ScoreCardProps) {
  return (
    <div className="bg-surface rounded-2xl p-5 text-center my-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-serif font-light text-[58px] leading-none" style={{ color }}>
        {score}
      </div>
      <div className="text-sm text-soft mt-1">{description}</div>
    </div>
  );
}
