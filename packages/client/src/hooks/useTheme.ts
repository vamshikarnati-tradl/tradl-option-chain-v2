import { useEffect, useState } from 'react';

export type Theme = 'terminal' | 'glass';
const KEY = 'tradl.theme';

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(KEY);
    return stored === 'glass' ? 'glass' : 'terminal';
  });

  useEffect(() => {
    document.body.classList.toggle('theme-glass', theme === 'glass');
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}
