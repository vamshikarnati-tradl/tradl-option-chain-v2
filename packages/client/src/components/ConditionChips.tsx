import { Chip } from './atoms';
import type { Condition, Operator } from '../core/types';

const OP_SYM: Record<Operator, string> = {
  gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠', between: '∈',
};

interface RawishCondition {
  // The AI's raw shape uses string operators and partial discriminator fields;
  // the engine's typed `Condition` narrows them. Accept either.
  lhs: { kind: 'field' | 'expr'; field?: string; expression?: string };
  operator: string;
  rhs: { kind: 'literal' | 'field' | 'expr' | 'range'; value?: number | [number, number]; field?: string; expression?: string };
}

interface Props {
  conditions: (Condition | RawishCondition)[];
  logic: 'AND' | 'OR';
  size?: 'sm' | 'md';
  /** Optional override for the rhs literal at this index (slider live-value). */
  liveRhsAt?: { index: number; value: number };
}

// Renders a list of conditions as `[lhs] [op] [rhs] AND/OR ...` chips.
// Detects `<field> * <number>` / `<number> * <field>` patterns on the rhs and
// renders them as `[N×] [field]` so multipliers read naturally.
export function ConditionChips({ conditions, logic, size = 'md', liveRhsAt }: Props) {
  return (
    <>
      {conditions.map((c, i) => {
        const isLast = i === conditions.length - 1;
        const opSym = OP_SYM[c.operator as Operator] ?? c.operator;
        const liveValue = liveRhsAt?.index === i ? liveRhsAt.value : undefined;
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            <Lhs lhs={c.lhs} size={size} />
            <Chip kind="op" size={size}>{opSym}</Chip>
            <Rhs rhs={c.rhs} size={size} liveValue={liveValue} />
            {!isLast && (
              <span className="font-mono text-[10px] text-ink-4 mx-0.5 uppercase tracking-[0.08em]">
                {logic}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

function Lhs({ lhs, size }: { lhs: RawishCondition['lhs']; size: 'sm' | 'md' }) {
  if (lhs.kind === 'field' && lhs.field) return <Chip kind="field" size={size}>{lhs.field}</Chip>;
  return <Chip kind="expr" size={size}>{lhs.expression ?? ''}</Chip>;
}

function Rhs({ rhs, size, liveValue }: {
  rhs: RawishCondition['rhs'];
  size: 'sm' | 'md';
  liveValue?: number;
}) {
  if (rhs.kind === 'literal') {
    const v = liveValue ?? (typeof rhs.value === 'number' ? rhs.value : null);
    return v != null ? <Chip kind="value" size={size}>{formatNum(v)}</Chip> : null;
  }
  if (rhs.kind === 'field' && rhs.field) return <Chip kind="field" size={size}>{rhs.field}</Chip>;
  if (rhs.kind === 'range' && Array.isArray(rhs.value)) {
    return <Chip kind="value" size={size}>[{rhs.value[0]}, {rhs.value[1]}]</Chip>;
  }
  if (rhs.kind === 'expr' && rhs.expression) {
    const split = splitFieldMultiplier(rhs.expression);
    if (split) {
      return (
        <span className="inline-flex items-center gap-1">
          <Chip kind="mult" size={size}>{formatNum(split.multiplier)}</Chip>
          <span className="font-mono text-[11px] text-ink-3">×</span>
          <Chip kind="field" size={size}>{split.field}</Chip>
        </span>
      );
    }
    return <Chip kind="expr" size={size}>{rhs.expression}</Chip>;
  }
  return null;
}

function splitFieldMultiplier(expr: string): { field: string; multiplier: number } | null {
  const m1 = expr.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\*\s*([\d.]+)$/);
  if (m1) return { field: m1[1], multiplier: Number(m1[2]) };
  const m2 = expr.trim().match(/^([\d.]+)\s*\*\s*([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (m2) return { field: m2[2], multiplier: Number(m2[1]) };
  return null;
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(Math.min(2, (n.toString().split('.')[1] ?? '').length));
}
