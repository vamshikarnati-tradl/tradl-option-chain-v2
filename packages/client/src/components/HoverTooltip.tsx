import type { OptionChainRow } from '../core/types';
import type { AppliedRule } from '../core/result-index';
import { ruleHsl } from '../core/palette';
import { fmtInt, fmtNum } from '../utils/format';

interface Props {
  row: OptionChainRow | null;
  matched: AppliedRule[] | null;
  mouse: { x: number; y: number } | null;
}

export function HoverTooltip({ row, matched, mouse }: Props) {
  if (!row || !mouse) return null;
  const x = Math.min(mouse.x + 14, window.innerWidth - 320);
  const y = Math.min(mouse.y + 14, window.innerHeight - 200);
  const rules = matched ?? [];
  return (
    <div
      style={{ left: x, top: y }}
      className="fixed z-[1000] bg-bg-2 border border-line-2 rounded-lg py-3 px-3.5 min-w-[280px] max-w-[320px] shadow-[0_12px_32px_rgba(0,0,0,0.6)] pointer-events-none"
    >
      <div className="flex items-baseline gap-2 border-b border-line pb-2 mb-2">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">strike</span>
        <strong className="font-mono text-sm tnum">{fmtInt(row.strikePrice)}</strong>
        <span className="ml-auto font-mono text-[11px] text-ink-3">spot {fmtNum(row.underlyingValue)}</span>
      </div>
      {rules.length > 0 ? (
        <div>
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">
            {rules.length} rule{rules.length > 1 ? 's' : ''} fired
          </div>
          {rules.map((a, i) => (
            <div
              key={a.rule.id}
              className={`grid items-start gap-2 py-1.5 ${i > 0 ? 'border-t border-dashed border-line' : ''}`}
              style={{ gridTemplateColumns: '8px 1fr' }}
            >
              <span className="w-2 h-2 rounded-sm mt-1" style={{ background: ruleHsl(a.rule.style.hue, 0.95) }} />
              <div>
                <div className="text-xs font-medium">{a.rule.name}</div>
                {a.rule.description && (
                  <div className="text-[10.5px] text-ink-3 leading-[1.4] mt-0.5" style={{ textWrap: 'pretty' }}>
                    {a.rule.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-ink-4 italic">no rules matched</div>
      )}
    </div>
  );
}
