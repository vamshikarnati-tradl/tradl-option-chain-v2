// Strip of chain-wide scalar values, displayed above the option-chain table.
// Each value renders as a label + formatted number. Errored values render
// the error message in muted red. The strip is the UI surface for the
// "value" artifact type.

import { useMemo } from 'react';
import type { ValueDefinition, ValueResult } from '../core/types';

interface Props {
  values: ValueDefinition[];
  results: ValueResult[];
}

function formatValue(v: number | null, fmt: ValueDefinition['format']): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const fixed = v.toFixed(fmt.decimals);
  if (fmt.type === 'percentage') return `${fixed}%`;
  if (fmt.type === 'currency') return `₹${fixed}`;
  // Add thousand separators for plain numbers when sensible.
  const n = Number(fixed);
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-IN', {
    minimumFractionDigits: fmt.decimals, maximumFractionDigits: fmt.decimals,
  });
  return fixed;
}

export function ValueStrip({ values, results }: Props) {
  const byId = useMemo(() => {
    const m = new Map<string, ValueResult>();
    for (const r of results) m.set(r.valueId, r);
    return m;
  }, [results]);

  if (values.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-x-5 gap-y-1.5 px-3 py-1.5 bg-bg-1 border-b border-line-1 text-[11.5px]"
      role="region"
      aria-label="Chain values"
    >
      {values.map((def) => {
        const r = byId.get(def.id);
        const label = def.displayLabel ?? def.name;
        const hasError = r?.error !== undefined;
        return (
          <div key={def.id} className="flex items-baseline gap-1.5" title={def.description}>
            <span className="text-ink-3">{label}</span>
            {hasError ? (
              <span className="font-mono text-neg" title={r?.error}>err</span>
            ) : (
              <span className="font-mono text-ink tabular-nums">
                {formatValue(r?.value ?? null, def.format)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
