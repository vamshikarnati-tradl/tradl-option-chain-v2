// Visual Mode renderer — AST → nested depth-shaded pills.
//
// Function calls become rounded labeled boxes (label in natural language —
// "TOP 3 OF", "ABSOLUTE VALUE OF", etc). Nested calls deeper inside get
// progressively lighter backgrounds. Comparisons + arithmetic stay inline
// (no box). Logical operators are amber word pills. Numbers are green pills
// with thousands separators. Variables are side-tinted mono identifiers.
// Durations and quoted strings get their own neutral pills.
//
// Click handlers on numeric literals (and unary-minus + num) report their
// AST char range up to the parent so the slider can bind.

import type { Expr, BinaryOp, FieldSpec } from '@tradl/shared';
import { FIELD_CATALOG, FUNCTION_CATALOG } from '@tradl/shared';

export interface LiteralRange { start: number; end: number; }

interface Props {
  ast: Expr;
  /** Char range of the currently bound slider literal, if any. */
  activeLiteral?: LiteralRange | null;
  /** Click handler for any numeric literal in the rendered output. */
  onLiteralClick?: (range: LiteralRange) => void;
  /** Compact mode: tighter padding / smaller text. For card lists. */
  compact?: boolean;
}

export function ExpressionView({ ast, activeLiteral, onLiteralClick, compact }: Props) {
  return (
    <div className={`expr-view ${compact ? 'expr-view-compact' : ''}`}>
      <Node node={ast} depth={0} topLevel={true}
        activeLiteral={activeLiteral} onLiteralClick={onLiteralClick}
      />
    </div>
  );
}

interface CommonProps {
  depth: number;
  topLevel: boolean;
  activeLiteral?: LiteralRange | null;
  onLiteralClick?: (range: LiteralRange) => void;
  /** Set by parent unary-minus so we can fuse `-N` into a single NumPill. */
  wrappingUnaryRange?: LiteralRange;
}

interface NodeProps extends CommonProps {
  node: Expr;
}

function Node({ node, ...rest }: NodeProps): JSX.Element {
  switch (node.kind) {
    case 'num':            return <NumPill {...rest} node={node} />;
    case 'const':          return <ConstPill name={node.name} />;
    case 'field':          return <VarPill name={node.name} />;
    case 'fieldLit':       return <VarPill name={node.name} muted />;
    case 'crossField':     return <VarPill name={node.name} cross />;
    case 'columnRef':      return <ColumnPill name={node.name} />;
    case 'crossColumnRef': return <ColumnPill name={node.name} cross />;
    case 'unresolvedIdent': return <UnresolvedPill name={node.name} cross={node.cross} />;
    case 'duration':       return <DurationPill literal={node.literal} />;
    case 'stringLit':      return <StringPill value={node.value} />;
    case 'unary':          return <UnaryNode {...rest} node={node} />;
    case 'binary':         return <BinaryNode {...rest} node={node} />;
    case 'ternary':        return <TernaryNode {...rest} node={node} />;
    case 'call':           return <CallNode {...rest} node={node} />;
  }
}

function ColumnPill({ name, cross }: { name: string; cross?: boolean }) {
  const display = cross ? `cross·${name}` : name;
  const title = cross
    ? `${name} — column value at the strike being iterated over`
    : `${name} — your saved column`;
  return (
    <span
      className={`expr-column${cross ? ' expr-column-cross' : ''}`}
      title={title}
    >
      {display}
    </span>
  );
}

function UnresolvedPill({ name, cross }: { name: string; cross: boolean }) {
  return (
    <span className="expr-unresolved" title="Unknown identifier — typo or a deleted column">
      {cross ? `cross_${name}` : name}
    </span>
  );
}

// ───────── Atoms ─────────

function VarPill({ name, muted, cross }: { name: string; muted?: boolean; cross?: boolean }) {
  const field = FIELD_CATALOG.find((f) => f.technicalName === name);
  const group = field?.group ?? 'market';
  const cls = `expr-var expr-var-${group}${muted ? ' expr-var-muted' : ''}${cross ? ' expr-var-cross' : ''}`;
  const display = cross ? `cross·${name}` : name;
  const title = cross
    ? `${field?.description ?? name} — value from the strike being iterated over`
    : field?.description ?? name;
  return <span className={cls} title={title}>{display}</span>;
}

function ConstPill({ name }: { name: string }) {
  return <span className="expr-const">{name}</span>;
}

function fmtNumber(n: number): string {
  // Thousands separator for any value >= 1000. Decimals preserved as written.
  if (Math.abs(n) < 1000) return String(n);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + abs.toLocaleString('en-US');
}

function NumPill({
  node, activeLiteral, onLiteralClick, wrappingUnaryRange,
}: CommonProps & { node: Extract<Expr, { kind: 'num' }> }) {
  // If wrapped by unary-minus, the num pill shows the negative form and uses
  // the unary's source range for slider binding.
  const range: LiteralRange | undefined = wrappingUnaryRange ?? (
    node.start !== undefined && node.end !== undefined
      ? { start: node.start, end: node.end }
      : undefined
  );
  const displayValue = wrappingUnaryRange ? -node.value : node.value;
  const isActive = !!activeLiteral && !!range
    && activeLiteral.start === range.start && activeLiteral.end === range.end;
  const handleClick = range && onLiteralClick
    ? () => onLiteralClick(range)
    : undefined;
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!handleClick}
      className={`expr-num ${isActive ? 'expr-num-active' : ''} ${handleClick ? 'expr-num-clickable' : ''}`}
    >
      {fmtNumber(displayValue)}
    </button>
  );
}

function DurationPill({ literal }: { literal: string }) {
  return <span className="expr-duration">{literal}</span>;
}

function StringPill({ value }: { value: string }) {
  return <span className="expr-string">{`'${value}'`}</span>;
}

// ───────── Compound nodes ─────────

function UnaryNode({
  node, depth, activeLiteral, onLiteralClick,
}: CommonProps & { node: Extract<Expr, { kind: 'unary' }> }) {
  // Fuse unary-minus on a literal into one NumPill: `-5000` reads as a single
  // negative number rather than `-` glyph + number.
  if (node.op === '-' && node.arg.kind === 'num') {
    const range: LiteralRange | undefined = node.start !== undefined && node.end !== undefined
      ? { start: node.start, end: node.end }
      : undefined;
    return (
      <NumPill
        node={node.arg}
        depth={depth}
        topLevel={false}
        wrappingUnaryRange={range}
        activeLiteral={activeLiteral}
        onLiteralClick={onLiteralClick}
      />
    );
  }
  const childCommon: CommonProps = { depth, topLevel: false, activeLiteral, onLiteralClick };
  // `+x` is a no-op visually; just render the inner node.
  if (node.op === '+') {
    return <Node {...childCommon} node={node.arg} />;
  }
  // `!x` renders as NOT pill + child.
  if (node.op === '!') {
    return (
      <span className="expr-row-gap">
        <LogicalPill op="!" />
        <Node {...childCommon} node={node.arg} />
      </span>
    );
  }
  return (
    <span className="expr-row">
      <span className="expr-arith-op">−</span>
      <Node {...childCommon} node={node.arg} />
    </span>
  );
}

function BinaryNode({
  node, depth, topLevel, activeLiteral, onLiteralClick,
}: CommonProps & { node: Extract<Expr, { kind: 'binary' }> }) {
  const childCommon: CommonProps = { depth, topLevel: false, activeLiteral, onLiteralClick };
  if (node.op === '||' || node.op === '&&') {
    return <LogicalRow node={node} forceVertical={topLevel} {...childCommon} />;
  }
  if (isCompareOp(node.op)) {
    return (
      <span className="expr-row-gap">
        <Node {...childCommon} node={node.left} />
        <ComparePill op={node.op} />
        <Node {...childCommon} node={node.right} />
      </span>
    );
  }
  // Arithmetic
  return (
    <span className="expr-row">
      <Node {...childCommon} node={node.left} />
      <span className="expr-arith-op">{arithGlyph(node.op)}</span>
      <Node {...childCommon} node={node.right} />
    </span>
  );
}

function LogicalRow({
  node, forceVertical, ...rest
}: CommonProps & { node: Extract<Expr, { kind: 'binary' }>; forceVertical: boolean }) {
  const op = node.op as '||' | '&&';
  const operands = collectChain(node, op);
  if (forceVertical && operands.length > 1) {
    return (
      <div className="expr-logical-stack">
        {operands.map((o, i) => (
          <div key={i} className="expr-logical-row">
            {i === 0
              ? <span className="expr-logical-spacer" />
              : <LogicalPill op={op} />}
            <Node {...rest} node={o} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <span className="expr-row-wrap">
      {operands.map((o, i) => (
        <span key={i} className="expr-row-gap">
          {i > 0 && <LogicalPill op={op} />}
          <Node {...rest} node={o} />
        </span>
      ))}
    </span>
  );
}

function TernaryNode({
  node, depth, activeLiteral, onLiteralClick,
}: CommonProps & { node: Extract<Expr, { kind: 'ternary' }> }) {
  const childCommon: CommonProps = { depth, topLevel: false, activeLiteral, onLiteralClick };
  return (
    <span className="expr-row-gap">
      <LogicalPill op="IF" />
      <Node {...childCommon} node={node.cond} />
      <LogicalPill op="THEN" />
      <Node {...childCommon} node={node.whenTrue} />
      <LogicalPill op="ELSE" />
      <Node {...childCommon} node={node.whenFalse} />
    </span>
  );
}

function CallNode({
  node, depth, activeLiteral, onLiteralClick,
}: CommonProps & { node: Extract<Expr, { kind: 'call' }> }) {
  // Special-case topN(x, num) → hoist the count into the label.
  let label = labelFor(node.name);
  let args = node.args;
  if (node.name === 'topN' && args[1]?.kind === 'num') {
    label = `TOP ${args[1].value} OF`;
    args = [args[0]];
  } else if (node.name === 'bottomN' && args[1]?.kind === 'num') {
    label = `BOTTOM ${args[1].value} OF`;
    args = [args[0]];
  }
  const cappedDepth = Math.min(depth, 3);
  const childCommon: CommonProps = {
    depth: depth + 1,
    topLevel: false,
    activeLiteral,
    onLiteralClick,
  };
  return (
    <span className={`expr-fn-box expr-fn-depth-${cappedDepth}`}>
      <span className="expr-fn-label">{label}</span>
      {args.map((a, i) => (
        <span key={i} className="expr-row-gap">
          {i > 0 && <span className="expr-comma">·</span>}
          <Node {...childCommon} node={a} />
        </span>
      ))}
    </span>
  );
}

// ───────── Pills ─────────

function LogicalPill({ op }: { op: '||' | '&&' | '!' | 'IF' | 'THEN' | 'ELSE' }) {
  const label = op === '||' ? 'OR'
    : op === '&&' ? 'AND'
    : op === '!' ? 'NOT'
    : op;
  return <span className="expr-logical">{label}</span>;
}

function ComparePill({ op }: { op: BinaryOp }) {
  const glyph = (
    op === '>=' ? '≥'
    : op === '<=' ? '≤'
    : op === '==' ? '='
    : op === '!=' ? '≠'
    : op
  );
  return <span className="expr-compare">{glyph}</span>;
}

// ───────── Helpers ─────────

function labelFor(name: string): string {
  const NL: Record<string, string> = {
    abs: 'ABSOLUTE VALUE OF',
    round: 'ROUNDED',
    floor: 'FLOOR OF',
    ceil: 'CEILING OF',
    sqrt: 'SQUARE ROOT OF',
    pow: 'POW',
    log: 'LOG OF',
    exp: 'EXP OF',
    sign: 'SIGN OF',
    min: 'MIN OF',
    max: 'MAX OF',
    sum: 'SUM OF',
    avg: 'AVERAGE OF',
    median: 'MEDIAN OF',
    stddev: 'STD DEV OF',
    variance: 'VARIANCE OF',
    range: 'RANGE OF',
    product: 'PRODUCT OF',
    clamp: 'CLAMP',
    lerp: 'LERP',
    ifelse: 'IF',
    any: 'ANY OF',
    all: 'ALL OF',
    count: 'COUNT OF',
    atStrike: 'AT STRIKE',
    atOffset: 'AT OFFSET',
    atm: 'AT THE MONEY',
    sumStrikes: 'SUM ACROSS STRIKES',
    avgStrikes: 'AVERAGE ACROSS STRIKES',
    medianStrikes: 'MEDIAN ACROSS STRIKES',
    minStrikes: 'MIN ACROSS STRIKES',
    maxStrikes: 'MAX ACROSS STRIKES',
    stddevStrikes: 'SPREAD ACROSS STRIKES',
    rank: 'RANK OF',
    pctile: 'PERCENTILE OF',
    topN: 'TOP OF',
    bottomN: 'BOTTOM OF',
  };
  if (NL[name]) return NL[name];
  const spec = FUNCTION_CATALOG.find((s) => s.technicalName === name);
  return spec ? spec.friendlyName.toUpperCase() : name.toUpperCase();
}

function isCompareOp(op: BinaryOp): boolean {
  return op === '>' || op === '<' || op === '>=' || op === '<=' || op === '==' || op === '!=';
}

function arithGlyph(op: BinaryOp): string {
  switch (op) {
    case '+': return '+';
    case '-': return '−';
    case '*': return '×';
    case '/': return '÷';
    case '%': return '%';
    default: return op;
  }
}

function collectChain(node: Expr, op: '||' | '&&'): Expr[] {
  const out: Expr[] = [];
  const walk = (e: Expr): void => {
    if (e.kind === 'binary' && e.op === op) {
      walk(e.left); walk(e.right);
    } else {
      out.push(e);
    }
  };
  walk(node);
  return out;
}

// FieldSpec re-export so callers can type-narrow if needed.
export type { FieldSpec };
