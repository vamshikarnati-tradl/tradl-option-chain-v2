import { useEffect, useState } from 'react';

export type FlashDir = 'flash-up' | 'flash-dn' | '';

// Returns a CSS class to flash for ~700ms when `value` changes vs `prevValue`.
// Used by FlashSpan + StackCell — both need the exact same logic.
export function useFlash(value: number | null | undefined, prevValue: number | undefined): FlashDir {
  const [flash, setFlash] = useState<FlashDir>('');
  useEffect(() => {
    if (
      prevValue === undefined ||
      typeof value !== 'number' ||
      typeof prevValue !== 'number' ||
      value === prevValue
    ) return;
    setFlash(value > prevValue ? 'flash-up' : 'flash-dn');
    const t = setTimeout(() => setFlash(''), 700);
    return () => clearTimeout(t);
  }, [value, prevValue]);
  return flash;
}
