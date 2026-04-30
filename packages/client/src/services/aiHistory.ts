// Local-only history of recent natural-language queries that resulted in an
// applied rule or column. Persisted to localStorage; capped at 8 entries.

const KEY = 'tradl.palette.recent';
const MAX = 8;

export interface RecentEntry {
  query: string;
  intent: 'rule' | 'column';
  name: string;          // applied rule/column name
  ts: number;
}

export function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function recordRecent(entry: Omit<RecentEntry, 'ts'>): RecentEntry[] {
  const current = loadRecent();
  // Move existing-same-query to top, otherwise prepend
  const filtered = current.filter((e) => e.query !== entry.query);
  const next: RecentEntry[] = [{ ...entry, ts: Date.now() }, ...filtered].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
