import { useMemo } from 'react';
import { GhostBtn, PrimaryBtn, StatePill } from '../atoms';

interface Props {
  json: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onApply: () => void;
}

export function EditJsonBody({ json, onChange, onCancel, onApply }: Props) {
  const isValid = useMemo(() => {
    try { JSON.parse(json); return true; } catch { return false; }
  }, [json]);

  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-2.5">
        <StatePill tone="neutral">{'{ } JSON'}</StatePill>
        <span className="text-[12.5px] text-ink-2">Edit raw definition</span>
        <span className="ml-auto font-mono text-[10px] text-ink-4">power-user escape hatch</span>
      </div>
      <textarea
        value={json}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={14}
        className="w-full bg-bg-1 border border-line text-codeblock font-mono text-[11px] leading-[1.5] px-2.5 py-2 rounded outline-none whitespace-pre-wrap resize-y focus:border-accent"
      />
      <div className="flex justify-between items-center mt-2">
        <span className={`font-mono text-[10px] ${isValid ? 'text-pos' : 'text-neg'}`}>
          {isValid ? '✓ valid JSON' : '✗ invalid JSON'}
        </span>
        <div className="flex gap-1.5">
          <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
          <PrimaryBtn onClick={onApply} disabled={!isValid}>Save & apply</PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
