import type {
  ColumnCellResult, CustomColumnDefinition, NumericField, OptionChainRow,
} from '../core/types';
import type { AppliedRule } from '../core/result-index';
import { ruleHsl } from '../core/palette';
import { evaluateWithTrace, type Expr } from '@tradl/shared';
import { parseAndResolve } from '../core/parse-and-resolve';
import { ExpressionView } from './rule-builder/ExpressionView';
import { fmtInt, fmtNum } from '../utils/format';

// One unified hover payload that combines row context (always present when a
// cell is hovered) with optional cell-specific detail. The tooltip renders the
// row header always, then a cell-specific block when applicable.
export interface HoverPayload {
  row: OptionChainRow;
  fields?: readonly NumericField[];
  applied?: AppliedRule[];
  custom?: { def: CustomColumnDefinition; cell: ColumnCellResult };
}

interface Props {
  payload: HoverPayload | null;
  mouse: { x: number; y: number } | null;
  /** Live custom columns — needed so the rule/column expression parse can
   *  resolve identifier-style column references like `maxPainLevel`. */
  columns?: readonly CustomColumnDefinition[];
}

function fmtVal(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1000) return fmtInt(Math.round(v));
  return fmtNum(v, 2);
}

export function HoverTooltip({ payload, mouse, columns }: Props) {
  if (!payload || !mouse) return null;
  const x = Math.min(mouse.x + 14, window.innerWidth - 360);
  const y = Math.min(mouse.y + 14, window.innerHeight - 260);
  const { row, applied, fields, custom } = payload;
  const hasRules = applied && applied.length > 0;
  const cols = columns ?? [];

  return (
    <div
      style={{ left: x, top: y }}
      className="fixed z-[1000] bg-bg-2 border border-line-2 rounded-lg py-3 px-3.5 min-w-[300px] max-w-[360px] shadow-[0_12px_32px_rgba(0,0,0,0.6)] pointer-events-none"
    >
      <div className="flex items-baseline gap-2 border-b border-line pb-2 mb-2">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">strike</span>
        <strong className="font-mono text-sm tnum">{fmtInt(row.strikePrice)}</strong>
        {fields && fields.length > 0 && (
          <span className="ml-2 font-mono text-[10px] text-ink-4">
            {fields.join(' · ')}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-ink-3">spot {fmtNum(row.underlyingValue)}</span>
      </div>

      {custom && <CustomColumnSection row={row} def={custom.def} cell={custom.cell} columns={cols} />}

      {hasRules && (
        <div className={custom ? 'mt-2 pt-2 border-t border-line' : ''}>
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">
            {applied!.length} rule{applied!.length === 1 ? '' : 's'} matched
          </div>
          <div className="space-y-2">
            {applied!.map((a) => (
              <RuleBlock key={a.rule.id} a={a} row={row} columns={cols} />
            ))}
          </div>
        </div>
      )}

      {!hasRules && !custom && (
        <div className="text-[11px] text-ink-4 italic">no rules matched this cell</div>
      )}
    </div>
  );
}

function RuleBlock({ a, row, columns }: {
  a: AppliedRule;
  row: OptionChainRow;
  columns: readonly CustomColumnDefinition[];
}) {
  let ast: Expr | null = null;
  let value: number | null = null;
  let fieldValues: { field: NumericField; value: number }[] = [];
  try {
    ast = parseAndResolve(a.rule.expression, columns);
    const trace = evaluateWithTrace(ast, row);
    value = trace.value;
    fieldValues = trace.fieldValues;
  } catch { /* parse failure — surface as plain text below */ }

  return (
    <div
      className="grid items-start gap-2"
      style={{ gridTemplateColumns: '8px 1fr' }}
    >
      <span className="w-2 h-2 rounded-sm mt-1" style={{ background: ruleHsl(a.rule.hue, 0.95) }} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{a.rule.name}</span>
        </div>
        {a.rule.description && (
          <div className="text-[10.5px] text-ink-3 leading-[1.4] mt-0.5" style={{ textWrap: 'pretty' }}>
            {a.rule.description}
          </div>
        )}
        {ast ? (
          <div className="mt-1.5">
            <ExpressionView ast={ast} compact />
          </div>
        ) : (
          <div className="font-mono text-[10.5px] text-ink-2 mt-1 break-words">{a.rule.expression}</div>
        )}
        {value !== null && (
          <div className="font-mono text-[10.5px] text-pos mt-1">
            ✓ matched (value = {value})
          </div>
        )}
        {fieldValues.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {fieldValues.map((fv) => (
              <div key={fv.field} className="font-mono text-[10.5px] text-ink-3">
                {fv.field} <span className="text-ink-2">= {fmtVal(fv.value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomColumnSection({ row, def, cell, columns }: {
  row: OptionChainRow;
  def: CustomColumnDefinition;
  cell: ColumnCellResult;
  columns: readonly CustomColumnDefinition[];
}) {
  let fieldValues: { field: NumericField; value: number }[] = [];
  let ast: Expr | null = null;
  try {
    ast = parseAndResolve(def.expression, columns);
    const trace = evaluateWithTrace(ast, row);
    fieldValues = trace.fieldValues;
  } catch { /* parse error — surfaced via cell.error below */ }
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">column</span>
        <span className="text-[11.5px] font-medium truncate">{def.name}</span>
      </div>
      {ast ? (
        <div className="mb-1">
          <ExpressionView ast={ast} compact />
        </div>
      ) : (
        <div className="font-mono text-[10.5px] text-ink-2 mb-1 break-words">{def.expression}</div>
      )}
      {cell.error ? (
        <div className="text-[11px] text-neg">{cell.error}</div>
      ) : (
        <div className="font-mono text-[10.5px]">
          <span className="text-ink-3">= </span>
          <span className="text-pos">{cell.value === null ? '—' : fmtVal(cell.value)}</span>
        </div>
      )}
      {fieldValues.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {fieldValues.map((fv) => (
            <div key={fv.field} className="font-mono text-[10.5px] text-ink-3">
              {fv.field} <span className="text-ink-2">= {fmtVal(fv.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
