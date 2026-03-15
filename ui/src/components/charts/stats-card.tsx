interface StatsCardProps {
  label: string;
  value: string;
  sub?: string;
}

export function StatsCard({ label, value, sub }: StatsCardProps) {
  return (
    <div class="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
      <p class="text-sm text-slate-400 mb-1">{label}</p>
      <p class="text-2xl font-bold text-slate-100">{value}</p>
      {sub && <p class="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}
