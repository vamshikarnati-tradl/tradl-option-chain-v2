import { useEffect, useState } from 'react';

export type Theme = 'paper' | 'frost' | 'clean' | 'terminal';
const KEY = 'tradl.theme';
const VALID: readonly Theme[] = ['paper', 'frost', 'clean', 'terminal'];

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(KEY);
    if (stored && (VALID as readonly string[]).includes(stored)) return stored as Theme;
    return 'paper';
  });

  useEffect(() => {
    const body = document.body.classList;
    // Toggle every theme class — only one is active at a time.
    body.toggle('theme-paper', theme === 'paper');
    body.toggle('theme-frost', theme === 'frost');
    body.toggle('theme-terminal', theme === 'terminal');
    body.remove('theme-glass');     // legacy theme — strip if a stale class is around
    // 'clean' has no class — it's the dark default
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}

// Cycle order shown in the header button: light first, dark second.
export const NEXT_THEME: Record<Theme, Theme> = {
  paper: 'frost',
  frost: 'clean',
  clean: 'terminal',
  terminal: 'paper',
};

export const THEME_LABELS: Record<Theme, string> = {
  paper: 'Paper',
  frost: 'Frost',
  clean: 'Clean',
  terminal: 'Terminal',
};
