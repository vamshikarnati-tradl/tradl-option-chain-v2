import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Card width. Default 560px. */
  width?: number;
}

// Generic modal: backdrop, centered card, esc + click-outside close.
//
// Rendered via portal into <body> so the modal escapes any ancestor's
// transform/filter/perspective. (Panels use translateX for their slide
// animation, which would otherwise re-anchor `position: fixed` children to
// the panel's box instead of the viewport.)
export function Modal({ open, onClose, title, subtitle, children, width = 560 }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const node = (
    <div
      className="fixed inset-0 z-[1500] flex items-start justify-center pt-[12vh] bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={cardRef}
        style={{ width: `min(${width}px, 92vw)`, maxHeight: '76vh' }}
        className="bg-bg-1 border border-line-2 rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col"
      >
        <header className="flex items-center justify-between h-12 px-4 border-b border-line shrink-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
            {subtitle && (
              <span className="font-mono text-[10.5px] text-ink-3">{subtitle}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition-colors"
            title="Close"
          >
            <Icon name="x" size={15} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
