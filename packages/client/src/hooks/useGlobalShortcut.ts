import { useEffect } from 'react';

interface Args {
  onSlash: () => void;
  onCmdK: () => void;
}

// Wires `/` (open at cursor) and Cmd/Ctrl+K (open centered) globally.
// Skips when focus is in a typeable element so the shortcut doesn't hijack
// real text input.
export function useGlobalShortcut({ onSlash, onCmdK }: Args) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const isSlash = e.key === '/' && !inField;
      if (isCmdK) { e.preventDefault(); onCmdK(); }
      else if (isSlash) { e.preventDefault(); onSlash(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSlash, onCmdK]);
}
