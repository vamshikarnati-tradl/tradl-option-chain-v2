import { useMemo } from 'react';
import { GhostBtn, Kbd, PrimaryBtn, StatePill } from '../../atoms';
import { ConfidenceBar, WarningBanner } from '../atoms';
import { dryRunColumn, type ColumnSample } from '../../../services/aiPreview';
import { fmtNum } from '../../../utils/format';
import type { AIParseResult } from '../../../services/aiParse';
import type { OptionChainRow } from '../../../core/types';

interface Props {
  result: AIParseResult;
  rows: OptionChainRow[];
  onApply: () => void;
  onEditJson: () => void;
  onRephrase: () => void;
}

export function ColumnPreview({ result, rows, onApply, onEditJson, onRephrase }: Props) {
  const c = result.column!;
  const samples: ColumnSample[] = useMemo(() => dryRunColumn(c.expression, rows), [c.expression, rows]);
  const isLow = result.confidence < 0.7;

  const fmtSample = (s: ColumnSample) => {
    if (s.value == null) return '—';
    const n = fmtNum(s.value, c.format.decimals);
    return c.format.type === 'percentage' ? `${n}%` : c.format.type === 'currency' ? `₹${n}` : n;
  };

  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-3">
        <StatePill tone="accent">ƒ Column</StatePill>
        <span className="text-[13px] font-medium truncate">{c.name}</span>
        <StatePill tone="neutral">{c.format.type}</StatePill>
        <span className="ml-auto"><ConfidenceBar value={result.confidence} /></span>
      </div>

      {isLow && (
        <WarningBanner heading="Best guess." body="Verify the expression before adding." />
      )}

      <code className="block bg-bg-1 border border-line rounded-lg px-3 py-2 font-mono text-[12px] text-codeblock mb-3 break-all">
        {c.expression}
      </code>

      {samples.length > 0 && (
        <>
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">Sample (around ATM)</div>
          <div className="bg-bg-1 border border-line rounded-lg overflow-hidden mb-3">
            {samples.map((s, i) => (
              <div
                key={s.strikePrice}
                className={
                  'flex items-center justify-between px-3 py-1.5 font-mono text-[11.5px] tnum '
                  + (i > 0 ? 'border-t border-line ' : '')
                  + (s.isAtm ? 'bg-warn-banner' : '')
                }
              >
                <span className="text-ink-3">strike</span>
                <span className="text-ink-2">{s.strikePrice.toLocaleString('en-IN')}</span>
                <span className="text-ink-3">→</span>
                <span className={s.value == null ? 'text-ink-4 italic' : 'text-pos'}>
                  {fmtSample(s)}
                </span>
                <span className="text-ink-4 text-[10px] w-8 text-right">{s.isAtm ? 'ATM' : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex gap-1.5 justify-end">
        {isLow && <GhostBtn onClick={onRephrase}>Rephrase</GhostBtn>}
        <GhostBtn onClick={onEditJson}>{'</> Edit JSON'}</GhostBtn>
        <PrimaryBtn onClick={onApply}>
          ✓ Add column <Kbd size="xs" className="hidden md:inline-block">↵</Kbd>
        </PrimaryBtn>
      </div>
    </div>
  );
}
