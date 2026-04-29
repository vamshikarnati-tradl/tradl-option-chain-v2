import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label?: string;
  width?: number;
}

export function Dropdown({ value, options, onChange, label, width = 130 }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={ref} className="relative" style={{ minWidth: width }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-7 px-2.5 w-full justify-between bg-bg-2 border border-line rounded-md text-ink text-xs hover:border-line-2 transition-colors"
      >
        {label && (
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">{label}</span>
        )}
        <span className="font-mono text-xs font-medium">{value}</span>
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
