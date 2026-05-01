import { useEffect, useMemo, useRef } from 'react';
import type { OptionChainRow } from '../core/types';

// Tracks the previous-snapshot rows by strike so flash-on-change cells can
// compare values. Returns the *prior* snapshot's map; the live snapshot is
// captured into a ref after each render so the next render sees it as `prev`.
export function usePrevSnapshot(rows: OptionChainRow[]): Map<number, OptionChainRow> {
  const prevRef = useRef<Map<number, OptionChainRow>>(new Map());

  const nextSnapshot = useMemo(() => {
    const m = new Map<number, OptionChainRow>();
    for (const r of rows) m.set(r.strikePrice, r);
    return m;
  }, [rows]);

  const prev = prevRef.current;

  useEffect(() => {
    prevRef.current = nextSnapshot;
  }, [nextSnapshot]);

  return prev;
}
