import { useRef } from 'react';

interface Result {
  baseSpot: number;
  spotChange: number;
  spotPct: number;
}

// Captures the first non-zero spot seen in the session and reports the delta
// of the current value vs that base. Used to render the session-relative
// change in the header.
export function useSessionBaseSpot(currentSpot: number): Result {
  const baseRef = useRef<number | null>(null);
  if (baseRef.current == null && currentSpot > 0) {
    baseRef.current = currentSpot;
  }
  const baseSpot = baseRef.current ?? currentSpot ?? 1;
  const spotChange = currentSpot - baseSpot;
  const spotPct = baseSpot ? (spotChange / baseSpot) * 100 : 0;
  return { baseSpot, spotChange, spotPct };
}
