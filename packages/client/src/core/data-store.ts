import type { OptionChainRow, OptionChainSnapshot, SnapshotSource } from './types';

type Listener = () => void;

export interface DataStoreState {
  symbol: string;
  expiryDate: string | null;
  underlyingValue: number;
  fetchedAt: number;
  rows: OptionChainRow[];           // sorted by strike
  rowsByStrike: Map<number, OptionChainRow>;
  changedStrikes: Set<number>;       // strikes whose values differ from prev snapshot
  status: 'connecting' | 'open' | 'closed' | 'error';
  error: string | null;
  snapshotCount: number;
  source: SnapshotSource | null;
}

const ROW_FIELDS_TO_DIFF: ReadonlyArray<keyof OptionChainRow> = [
  'call_oi', 'call_oiChange', 'call_volume', 'call_iv', 'call_ltp',
  'call_netChange', 'call_bidQty', 'call_bidPrice', 'call_askQty', 'call_askPrice',
  'call_delta', 'call_gamma', 'call_theta', 'call_vega',
  'put_oi', 'put_oiChange', 'put_volume', 'put_iv', 'put_ltp',
  'put_netChange', 'put_bidQty', 'put_bidPrice', 'put_askQty', 'put_askPrice',
  'put_delta', 'put_gamma', 'put_theta', 'put_vega',
  'underlyingValue',
];

function rowsDiffer(a: OptionChainRow, b: OptionChainRow): boolean {
  for (const f of ROW_FIELDS_TO_DIFF) {
    if (a[f] !== b[f]) return true;
  }
  return false;
}

export class DataStore {
  private state: DataStoreState;
  private listeners = new Set<Listener>();

  constructor(symbol: string) {
    this.state = {
      symbol,
      expiryDate: null,
      underlyingValue: 0,
      fetchedAt: 0,
      rows: [],
      rowsByStrike: new Map(),
      changedStrikes: new Set(),
      status: 'connecting',
      error: null,
      snapshotCount: 0,
      source: null,
    };
  }

  getState(): DataStoreState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  applySnapshot(snapshot: OptionChainSnapshot): void {
    const changed = new Set<number>();
    const nextByStrike = new Map<number, OptionChainRow>();
    for (const row of snapshot.rows) {
      const prev = this.state.rowsByStrike.get(row.strikePrice);
      if (!prev || rowsDiffer(prev, row)) changed.add(row.strikePrice);
      nextByStrike.set(row.strikePrice, row);
    }
    this.state = {
      ...this.state,
      expiryDate: snapshot.expiryDate,
      underlyingValue: snapshot.underlyingValue,
      fetchedAt: snapshot.fetchedAt,
      rows: snapshot.rows,
      rowsByStrike: nextByStrike,
      changedStrikes: changed,
      status: 'open',
      error: null,
      snapshotCount: this.state.snapshotCount + 1,
      source: snapshot.source,
    };
    this.emit();
  }

  setStatus(status: DataStoreState['status'], error: string | null = null): void {
    if (this.state.status === status && this.state.error === error) return;
    this.state = { ...this.state, status, error };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
