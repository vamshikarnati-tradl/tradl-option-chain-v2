import { useEffect, useState } from 'react';

// Reports the current cursor position. Used by HoverTooltip + CommandPalette
// (cursor-anchored mode). Single global listener, shared by all consumers
// of the result.
export function useMouseTracking(): { x: number; y: number } | null {
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  return mouse;
}
