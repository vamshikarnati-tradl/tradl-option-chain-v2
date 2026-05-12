import type {
  ColumnCellResult, Condition, CustomColumnDefinition, NumericField, OptionChainRow,
} from '../core/types';
import type { AppliedRule } from '../core/result-index';
import { ruleHsl } from '../core/palette';
import { parseExpression } from '../core/expression-parser';
import { evaluate } from '../core/expression-evaluator';
import { fmtInt, fmtNum } from '../utils/format';

// One unified hover payload that combines row context (always present when a
// cell is hovered) with optional cell-specific detail. The tooltip renders the
// row header always, then a cell-specific block when applicable.
export interface HoverPayload {
  row: OptionChainRow;
  // Fields the hovered cell visually represents (e.g. ['call_oi','call_oiChange']
  // for the Call OI column). Drives the per-cell rules section.
  fields?: readonly NumericField[];
  // Rules currently tinting the hovered cell. Drives the rule list with live
  // values substituted into each condition.
  applied?: AppliedRule[];
  // Set for custom-column cells — adds an expression/value/sub-values block.
  custom?: { def: CustomColumnDefinition; cell: ColumnCellResult };
}

interface Props {
  payload: HoverPayload | null;
  mouse: { x: number; y: number } | null;
}

const OP_LABEL: Record<string, string> = {
  gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠', between: 'in',
};

function fmtVal(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1000) return fmtInt(Math.round(v));
  return fmtNum(v, 2);
}

function sideSource(side: Condition['lhs'] | Condition['rhs']): string {
  if (side.kind === 'field') return side.field;
  if (side.kind === 'expr') return side.expression;
  if (side.kind === 'literal') return fmtVal(side.value);
  if (side.kind === 'range') return `${fmtVal(side.value[0])}…${fmtVal(side.value[1])}`;
  return '';
}

function sideValue(side: Condition['lhs'] | Condition['rhs'], row: OptionChainRow): number | [number, number] | null {
  try {
    if (side.kind === 'field') return row[side.field];
    if (side.kind === 'expr') return evaluate(parseExpression(side.expression), row);
    if (side.kind === 'literal') return side.value;
    if (side.kind === 'range') return side.value;
  } catch { /* fall through */ }
  return null;
}

export function HoverTooltip({ payload, mouse }: Props) {
  if (!payload || !mouse) return null;
  const x = Math.min(mouse.x + 14, window.innerWidth - 340);
  const y = Math.min(mouse.y + 14, window.innerHeight - 240);
  const { row, applied, fields, custom } = payload;
  const hasRules = applied && applied.length > 0;

  return (
    <div
      style={{ left: x, top: y }}
      className="fixed z-[1000] bg-bg-2 border border-line-2 rounded-lg py-3 px-3.5 min-w-[300px] max-w-[340px] shadow-[0_12px_32px_rgba(0,0,0,0.6)] pointer-events-none"
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

      {custom && <CustomColumnSection row={row} def={custom.def} cell={custom.cell} />}

      {hasRules && (
        <div className={custom ? 'mt-2 pt-2 border-t border-line' : ''}>
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">
            {applied!.length} rule{applied!.length === 1 ? '' : 's'} fired
          </div>
          <div className="space-y-1.5">
            {applied!.map((a) => (
              <RuleBlock key={a.rule.id} a={a} row={row} />
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

function RuleBlock({ a, row }: { a: AppliedRule; row: OptionChainRow }) {
  return (
    <div
      className="grid items-start gap-2"
      style={{ gridTemplateColumns: '8px 1fr' }}
    >
      <span className="w-2 h-2 rounded-sm mt-1" style={{ background: ruleHsl(a.rule.style.hue, 0.95) }} />
      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{a.rule.name}</span>
          {a.rule.conditions.length > 1 && (
            <span className="text-[9px] font-mono text-ink-4 uppercase">{a.rule.logic}</span>
          )}
        </div>
        {a.rule.description && (
          <div className="text-[10.5px] text-ink-3 leading-[1.4] mt-0.5" style={{ textWrap: 'pretty' }}>
            {a.rule.description}
          </div>
        )}
        <div className="space-y-0.5 mt-1">
          {a.rule.conditions.map((c, i) => (
            <ConditionLine
              key={i}
              cond={c}
              row={row}
              fired={a.matchedConditionIndices.includes(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConditionLine({ cond, row, fired }: { cond: Condition; row: OptionChainRow; fired: boolean }) {
  const lhsSrc = sideSource(cond.lhs);
  const rhsSrc = sideSource(cond.rhs);
  const lhsVal = sideValue(cond.lhs, row);
  const rhsVal = sideValue(cond.rhs, row);
  const fmtSide = (v: number | [number, number] | null) =>
    v === null ? '—' : Array.isArray(v) ? `${fmtVal(v[0])}…${fmtVal(v[1])}` : fmtVal(v);
  return (
    <div className="font-mono text-[10.5px] leading-[1.5]">
      <span className={fired ? 'text-pos' : 'text-ink-3'}>{fired ? '✓' : '·'}</span>{' '}
      <span className="text-ink-2">{lhsSrc}</span>
      <span className="text-ink-4"> ({fmtSide(lhsVal)}) </span>
      <span className="text-ink-3">{OP_LABEL[cond.operator] ?? cond.operator}</span>{' '}
      <span className="text-ink-2">{rhsSrc}</span>
      <span className="text-ink-4"> ({fmtSide(rhsVal)})</span>
    </div>
  );
}

function CustomColumnSection({ row, def, cell }: { row: OptionChainRow; def: CustomColumnDefinition; cell: ColumnCellResult }) {
  let fieldValues: { field: NumericField; value: number }[] = [];
  try {
    const ast = parseExpression(def.expression);
    fieldValues = collectDeps(ast).map((f) => ({ field: f, value: row[f] }));
  } catch { /* parse error — surfaced via cell.error below */ }
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">column</span>
        <span className="text-[11.5px] font-medium truncate">{def.name}</span>
      </div>
      <div className="font-mono text-[10.5px] text-ink-2 mb-1 break-words">{def.expression}</div>
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

function collectDeps(ast: ReturnType<typeof parseExpression>): NumericField[] {
  const out: NumericField[] = [];
  const seen = new Set<NumericField>();
  const walk = (e: typeof ast): void => {
    switch (e.kind) {
      case 'field':
        if (!seen.has(e.name)) { seen.add(e.name); out.push(e.name); }
        return;
      case 'unary': walk(e.arg); return;
      case 'binary': walk(e.left); walk(e.right); return;
      case 'ternary': walk(e.cond); walk(e.whenTrue); walk(e.whenFalse); return;
      case 'call': for (const a of e.args) walk(a); return;
      case 'num': case 'const': return;
    }
  };
  walk(ast);
  return out;
}
