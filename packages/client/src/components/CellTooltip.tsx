import { createPortal } from 'react-dom';
import type { AppliedRule } from '../core/result-index';
import type {
  ColumnCellResult, Condition, CustomColumnDefinition, NumericField, OptionChainRow,
} from '../core/types';
import { ruleHsl } from '../core/palette';
import { parseExpression } from '../core/expression-parser';
import { evaluate } from '../core/expression-evaluator';
import { fmtInt, fmtNum } from '../utils/format';

export interface CellTooltipAnchor {
  rect: DOMRect;
}

export type CellTooltipInfo =
  | {
      kind: 'rule';
      row: OptionChainRow;
      fields: readonly NumericField[];
      applied: AppliedRule[];
    }
  | {
      kind: 'custom';
      row: OptionChainRow;
      def: CustomColumnDefinition;
      cell: ColumnCellResult;
    };

export type CellTooltipPayload = CellTooltipInfo & { anchor: CellTooltipAnchor };

type RuleCellPayload = Extract<CellTooltipPayload, { kind: 'rule' }>;
type CustomCellPayload = Extract<CellTooltipPayload, { kind: 'custom' }>;

interface Props { payload: CellTooltipPayload | null }

const TOOLTIP_W = 320;

function fmtVal(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1000) return fmtInt(Math.round(v));
  return fmtNum(v, 2);
}

// Render `field` if kind=field, or the raw expression text if kind=expr.
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

const OP_LABEL: Record<string, string> = {
  gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠', between: 'in',
};

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

function position(anchor: CellTooltipAnchor): { left: number; top: number } {
  const { rect } = anchor;
  const w = TOOLTIP_W;
  const margin = 8;
  let left = rect.left + rect.width / 2 - w / 2;
  if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
  if (left < margin) left = margin;
  const top = rect.bottom + 6;
  return { left, top };
}

export function CellTooltip({ payload }: Props) {
  if (!payload) return null;
  const { left, top } = position(payload.anchor);

  const body = payload.kind === 'rule' ? (
    <RuleTooltipBody payload={payload} />
  ) : (
    <CustomTooltipBody payload={payload} />
  );

  return createPortal(
    <div
      style={{ left, top, width: TOOLTIP_W }}
      className="fixed z-[1000] bg-bg-2 border border-line-2 rounded-lg py-2.5 px-3 shadow-[0_12px_32px_rgba(0,0,0,0.6)] pointer-events-none"
    >
      {body}
    </div>,
    document.body,
  );
}

function RuleTooltipBody({ payload }: { payload: RuleCellPayload }) {
  const { row, fields, applied } = payload;
  return (
    <>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">
          {applied.length} rule{applied.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto font-mono text-[10px] text-ink-4">
          {fields.join(' · ')}
        </span>
      </div>
      <div className="space-y-2">
        {applied.map((a) => (
          <div key={a.rule.id} className="border-t border-dashed border-line first:border-0 first:pt-0 pt-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: ruleHsl(a.rule.style.hue, 0.95) }} />
              <span className="text-[11.5px] font-medium">{a.rule.name}</span>
              <span className="ml-auto text-[10px] text-ink-4 uppercase">{a.rule.logic}</span>
            </div>
            <div className="space-y-0.5">
              {a.rule.conditions.map((c, idx) => (
                <ConditionLine
                  key={idx}
                  cond={c}
                  row={row}
                  fired={a.matchedConditionIndices.includes(idx)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function CustomTooltipBody({ payload }: { payload: CustomCellPayload }) {
  const { row, def, cell } = payload;
  let fieldValues: { field: NumericField; value: number }[] = [];
  try {
    const ast = parseExpression(def.expression);
    const deps = collectDeps(ast);
    fieldValues = deps.map((f) => ({ field: f, value: row[f] }));
  } catch { /* leave empty on parse error */ }

  return (
    <>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">column</span>
        <span className="text-[11.5px] font-medium truncate">{def.name}</span>
      </div>
      <div className="font-mono text-[10.5px] text-ink-2 mb-2 break-words">{def.expression}</div>
      {cell.error ? (
        <div className="text-[11px] text-neg">{cell.error}</div>
      ) : (
        <div className="font-mono text-[10.5px]">
          <span className="text-ink-3">= </span>
          <span className="text-pos">
            {cell.value === null ? '—' : fmtVal(cell.value)}
          </span>
        </div>
      )}
      {fieldValues.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed border-line space-y-0.5">
          {fieldValues.map((fv) => (
            <div key={fv.field} className="font-mono text-[10.5px] text-ink-3">
              {fv.field} <span className="text-ink-2">= {fmtVal(fv.value)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Local copy to avoid pulling Expr type re-exports. Returns deduped fields in
// AST traversal order.
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
