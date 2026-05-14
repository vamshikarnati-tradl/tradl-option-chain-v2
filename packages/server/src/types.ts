import type { OptionChainRow } from '@tradl/shared';
export type { OptionChainRow, NumericField } from '@tradl/shared';
export { NUMERIC_FIELDS } from '@tradl/shared';

export type SnapshotSource = 'tradl-gateway' | 'nse' | 'mock';

export interface OptionChainSnapshot {
  symbol: string;
  expiryDate: string;
  underlyingValue: number;
  fetchedAt: number;
  rows: OptionChainRow[];
  // Which upstream produced this snapshot. Surfaced in the client UI so the
  // user can tell at a glance whether they're looking at live or fallback data.
  source: SnapshotSource;
}

export type WsServerMessage =
  | { type: 'snapshot'; payload: OptionChainSnapshot }
  | { type: 'error'; message: string };
