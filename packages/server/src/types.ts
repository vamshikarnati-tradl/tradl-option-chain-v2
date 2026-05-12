import type { OptionChainRow } from '@tradl/shared';
export type { OptionChainRow, NumericField } from '@tradl/shared';
export { NUMERIC_FIELDS } from '@tradl/shared';

export interface OptionChainSnapshot {
  symbol: string;
  expiryDate: string;
  underlyingValue: number;
  fetchedAt: number;
  rows: OptionChainRow[];
}

export type WsServerMessage =
  | { type: 'snapshot'; payload: OptionChainSnapshot }
  | { type: 'error'; message: string };
