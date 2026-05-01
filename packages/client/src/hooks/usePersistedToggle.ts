import { useEffect, useState } from 'react';

// Boolean state mirrored to localStorage. Survives reloads.
export function usePersistedToggle(key: string): [boolean, (v: boolean | ((b: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => localStorage.getItem(key) === '1');
  useEffect(() => { localStorage.setItem(key, value ? '1' : '0'); }, [key, value]);
  return [value, setValue];
}
