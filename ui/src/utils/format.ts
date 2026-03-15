export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDate(ts: number): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleString();
}
