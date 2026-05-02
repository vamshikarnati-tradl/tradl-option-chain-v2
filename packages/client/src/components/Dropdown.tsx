import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useIsMobile } from '../hooks/useMediaQuery';

interface Props<T extends string> {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  label?: string;
  width?: number;
  /** Narrower min-width for `< sm` viewports. Falls back to `width`. */
  mobileWidth?: number;
  /** Hide the `label` chip on `< sm` to free up space (header expiry). */
  hideLabelOnMobile?: boolean;
}

// Generic over the option type so callers don't need `as Symbol` / `as Theme`
// casts on the onChange handler.
export function Dropdown<T extends string>({
  value, options, onChange, label, width = 130, mobileWidth, hideLabelOnMobile = false,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const w = isMobile && mobileWidth ? mobileWidth : width;
  // On mobile, lock width so the value-side `truncate` actually clips long
  // strings (e.g. "07-May-2026" expiry). On desktop, keep min-width so the
  // dropdown can grow to fit longer values without truncation.
  const wrapStyle: React.CSSProperties = isMobile && mobileWidth
    ? { width: w, minWidth: w, maxWidth: w }
    : { minWidth: w };

  return (
    <div ref={ref} className="relative shrink-0" style={wrapStyle}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 sm:gap-2 h-7 px-2 sm:px-2.5 w-full justify-between bg-bg-2 border border-line rounded-md text-ink text-[11px] sm:text-xs hover:border-line-2 transition-colors min-w-0"
      >
        {label && (
          <span className={`font-mono text-[9.5px] sm:text-[10px] text-ink-3 uppercase tracking-[0.06em] sm:tracking-[0.08em] ${
            hideLabelOnMobile ? 'hidden sm:inline' : ''
          }`}>{label}</span>
        )}
        <span className="font-mono text-[11px] sm:text-xs font-medium truncate">{value}</span>
        <Icon name="chevDown" size={12} />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 min-w-full bg-bg-2 border border-line-2 rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.6)] overflow-hidden z-[100] p-1">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false); }}
              className={`flex items-center justify-between w-full px-2.5 py-1.5 bg-transparent border-0 font-mono text-xs rounded text-left transition-colors hover:bg-bg-3 hover:text-ink ${o === value ? 'text-ink' : 'text-ink-2'}`}
            >
              {o}
              {o === value && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
