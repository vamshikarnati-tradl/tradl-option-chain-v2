import { useCallback, useState } from 'react';
import { PAL_W } from '../components/CommandPalette/types';

export type PaletteAnchor = 'cursor' | { x: number; y: number };

interface Result {
  open: boolean;
  anchor: PaletteAnchor;
  openAtCursor: () => void;
  openCentered: () => void;
  close: () => void;
}

// Owns palette open/closed state + anchor mode. The two open helpers map to
// the two UX entry points: `/` shortcut (cursor-anchored, follows mouse) and
// Ask button / Cmd+K (pinned, feels like a centered modal).
export function usePaletteController(): Result {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<PaletteAnchor>('cursor');

  const openAtCursor = useCallback(() => {
    setAnchor('cursor');
    setOpen(true);
  }, []);

  const openCentered = useCallback(() => {
    setAnchor({
      x: Math.max(20, (window.innerWidth - PAL_W) / 2),
      y: Math.max(60, window.innerHeight * 0.18),
    });
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return { open, anchor, openAtCursor, openCentered, close };
}
