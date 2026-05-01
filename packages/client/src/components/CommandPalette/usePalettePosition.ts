import { useEffect, useState, type RefObject } from 'react';
import { PAL_H_EST, PAL_MARGIN, PAL_W } from './types';

interface Args {
  open: boolean;
  anchor: 'cursor' | { x: number; y: number };
  mouse: { x: number; y: number } | null;
  rootRef: RefObject<HTMLDivElement>;
  /** Bumped by the parent when the user types — locks the palette in place. */
  inputLength: number;
}

interface Result {
  left: number;
  top: number;
  frozen: boolean;
  /** Call from onMouseEnter — locks position when the user hovers in. */
  freezeAtCurrentRect: () => void;
}

// Owns the cursor-follow / freeze-and-pin position state. Two modes:
// - anchor='cursor' starts free (eases with the mouse), locks once the user
//   types or pointer-enters the panel.
// - anchor={x,y} starts already locked at the supplied coordinate (Ask
//   button + Cmd+K — feels like a centered modal).
export function usePalettePosition({ open, anchor, mouse, rootRef, inputLength }: Args): Result {
  const [frozen, setFrozen] = useState(false);
  const [frozenPos, setFrozenPos] = useState<{ x: number; y: number } | null>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    if (anchor === 'cursor') {
      setFrozen(false);
      setFrozenPos(null);
    } else {
      setFrozen(true);
      setFrozenPos({ x: anchor.x, y: anchor.y });
    }
  }, [open, anchor]);

  // Lock on first keystroke — typing shouldn't make the panel slide.
  useEffect(() => {
    if (open && inputLength > 0 && !frozen && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      setFrozenPos({ x: r.left, y: r.top });
      setFrozen(true);
    }
  }, [open, inputLength, frozen, rootRef]);

  let left: number;
  let top: number;
  if (frozen && frozenPos) {
    left = frozenPos.x;
    top = frozenPos.y;
  } else {
    const ax = mouse?.x ?? window.innerWidth / 2;
    const ay = mouse?.y ?? window.innerHeight / 3;
    left = ax + 16;
    if (left + PAL_W + PAL_MARGIN > window.innerWidth) left = Math.max(PAL_MARGIN, ax - 16 - PAL_W);
    top = ay + 12;
    if (top + PAL_H_EST + PAL_MARGIN > window.innerHeight) {
      top = Math.max(PAL_MARGIN, window.innerHeight - PAL_H_EST - PAL_MARGIN);
    }
  }

  const freezeAtCurrentRect = () => {
    if (!frozen && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      setFrozenPos({ x: r.left, y: r.top });
      setFrozen(true);
    }
  };

  return { left, top, frozen, freezeAtCurrentRect };
}
