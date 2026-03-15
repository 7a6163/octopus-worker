import type { HourlyStat } from '@ui/api/stats';

interface HourlyChartProps {
  data: HourlyStat[];
}

export function HourlyChart({ data }: HourlyChartProps) {
  const maxRequests = Math.max(...data.map((d) => d.requests), 1);
  const barWidth = 100 / 24;

  return (
    <div class="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
      <h3 class="text-sm font-medium text-slate-400 mb-4">Hourly Requests</h3>
      <div class="relative h-40">
        <svg viewBox="0 0 100 50" class="w-full h-full" preserveAspectRatio="none">
          {data.map((d) => {
            const height = (d.requests / maxRequests) * 45;
            const x = d.hour * barWidth + barWidth * 0.15;
            const width = barWidth * 0.7;
            return (
              <g key={d.hour}>
                <rect
                  x={x}
                  y={50 - height}
                  width={width}
                  height={height}
                  rx={0.5}
                  fill="#3b82f6"
                  opacity={0.8}
                >
                  <title>{`${d.hour}:00 - ${d.requests} requests`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>
      <div class="flex justify-between mt-1 text-xs text-slate-500">
        <span>0:00</span>
        <span>6:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
    </div>
  );
}
