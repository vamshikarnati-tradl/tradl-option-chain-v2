// Number / time formatters used across the UI.
// Matches the design's en-IN locale and dash placeholder.

const DASH = '—';

export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return DASH;
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return DASH;
  return Math.round(n).toLocaleString('en-IN');
}

export function fmtChange(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return DASH;
  const sign = n >= 0 ? '+' : '';
  return sign + n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return DASH;
  return n.toFixed(decimals) + '%';
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

export function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 1) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
