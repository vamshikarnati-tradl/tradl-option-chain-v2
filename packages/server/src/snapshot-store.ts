// Tiny in-memory cache of the most recent snapshot per symbol. The poll loop
// in index.ts feeds this on every successful tick. Other modules (e.g. the AI
// validator) read it for sample-row dry-runs without coupling to index.ts.

import type { OptionChainRow, OptionChainSnapshot } from './types.js';

const snapshots = new Map<string, OptionChainSnapshot>();

export function setLatestSnapshot(symbol: string, snap: OptionChainSnapshot): void {
  snapshots.set(symbol, snap);
}

export function getLatestSnapshot(symbol: string): OptionChainSnapshot | null {
  return snapshots.get(symbol) ?? null;
}

// Return the row whose strike is closest to the underlying value — the ATM
// strike. Used as the dry-run sample row: avoids the divide-by-zero traps that
// the deep-OTM/ITM rows can trigger (e.g. put_ltp ≈ 0 deep on the call side).
export function getAtmRow(symbol: string): OptionChainRow | null {
  const snap = snapshots.get(symbol);
  if (!snap || !snap.rows.length) return null;
  const spot = snap.underlyingValue;
  let best = snap.rows[0];
  let bestDist = Math.abs(best.strikePrice - spot);
  for (const r of snap.rows) {
    const d = Math.abs(r.strikePrice - spot);
    if (d < bestDist) { best = r; bestDist = d; }
  }
  return best;
}
