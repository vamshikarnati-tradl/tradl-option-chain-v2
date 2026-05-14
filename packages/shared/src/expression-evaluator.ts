import type { Expr, BinaryOp } from './expression-parser.js';
import type { NumericField, OptionChainRow } from './fields.js';

const CONSTS = { PI: Math.PI, E: Math.E } as const;

// ─────── Evaluation context ───────
//
// `snapshot` carries the full chain (needed for cross-strike functions).
// `history` / `historical` are reserved for Phase 2 / Phase 3 and unused now.
//
// `_trace` is a private callback set by `evaluateWithTrace` so that field
// reads (and cross-strike fieldLit usage) get reported back to the caller as
// they happen. Because the trace runs during real evaluation it respects
// `&&`/`||` short-circuit and ternary branch selection — only the cells
// actually consulted on this row are reported.

export interface EvalContext {
  snapshot?: readonly OptionChainRow[];
  /** Saved-column per-strike values, keyed by column id. Populated by the
   *  compute engine after the column-evaluation pass; consumed by `columnRef`
   *  and `crossColumnRef` AST nodes during rule evaluation (and any column
   *  that references another column). */
  columnValues?: ReadonlyMap<string, ReadonlyMap<number, number>>;
  /** Compiled column ASTs keyed by id. Optional — only needed when the trace
   *  evaluator wants to recursively trace field reads through column
   *  references. The compute engine wires this. */
  compiledColumns?: ReadonlyMap<string, Expr>;
  /** Reserved for Phase 2 — intraday history. Not used yet. */
  history?: unknown;
  /** Reserved for Phase 3 — backend historical data. Not used yet. */
  historical?: unknown;
}

type FieldRead = { field: NumericField; value: number };
type ColumnRead = { columnId: string; columnName: string; value: number };

interface InternalContext extends EvalContext {
  _trace?: (read: FieldRead) => void;
  /** Separate sink for column-level reads. Reported when a rule (or column)
   *  evaluates a `columnRef` on the outer row — drives column-cell tinting.
   *  Cross-column reads do NOT report here (same reasoning as crossField). */
  _traceColumn?: (read: ColumnRead) => void;
  /** The strike row currently being iterated over by a `*OverStrikes(...)`
   *  call. `crossField` reads this slot; outside such a call it's undefined
   *  and reading a `cross_*` field throws. */
  crossRow?: OptionChainRow;
}

/** Argument target for a cross-strike builtin: either a raw field name on
 *  the row, or a saved column whose per-strike values are in `ctx.columnValues`. */
type FieldOrColumnTarget =
  | { kind: 'field'; field: NumericField }
  | { kind: 'column'; id: string; name: string };

/** Resolve a cross-strike builtin's first argument. Accepts a `fieldLit`
 *  (raw field) or a `columnRef` (saved column). Also reports the read to
 *  the trace sink as a field read on the outer row, so cross-strike rules
 *  tint the right cells. */
function readFieldOrColumnRef(
  arg: Expr, row: OptionChainRow, ctx: EvalContext,
): FieldOrColumnTarget {
  if (arg.kind === 'fieldLit') {
    (ctx as InternalContext)._trace?.({ field: arg.name, value: row[arg.name] });
    return { kind: 'field', field: arg.name };
  }
  if (arg.kind === 'columnRef') {
    // No direct row read — the column's own field reads were traced when
    // its AST was evaluated for this strike (see the columnRef case in
    // `evaluate`). We avoid double-tracing here.
    return { kind: 'column', id: arg.id, name: arg.name };
  }
  throw new Error('Expected a field name or column reference as the first argument');
}

/** Read the target's value on a given snapshot row, going through the
 *  precomputed column-value map for column targets. */
function readTargetAt(target: FieldOrColumnTarget, row: OptionChainRow, ctx: EvalContext): number {
  if (target.kind === 'field') return row[target.field];
  const v = ctx.columnValues?.get(target.id)?.get(row.strikePrice);
  return v === undefined ? NaN : v;
}

const EMPTY_CTX: EvalContext = {};

// ─────── Builtin implementations ───────

type BuiltinImpl = (args: Expr[], row: OptionChainRow, ctx: EvalContext) => number;

// Helper: evaluate a child as a number.
const ev = (e: Expr, row: OptionChainRow, ctx: EvalContext): number => evaluate(e, row, ctx);

// (readFieldLit was previously the helper for cross-strike builtins; all of
//  them now go through readFieldOrColumnRef + readTargetAt so they accept
//  saved-column references too. Kept the function pattern in mind so a
//  future Phase 2 time-aware builtin can resurrect it if it ever needs to
//  *only* accept raw fields.)

// Helper: require a snapshot for cross-strike functions.
function requireSnapshot(ctx: EvalContext, fnName: string): readonly OptionChainRow[] {
  if (!ctx.snapshot) {
    throw new Error(`${fnName}() needs the full option chain. The evaluator was called without a snapshot context.`);
  }
  return ctx.snapshot;
}

function aggregate(values: number[], op: 'sum' | 'avg' | 'median' | 'min' | 'max' | 'stddev' | 'product'): number {
  if (values.length === 0) return NaN;
  switch (op) {
    case 'sum': return values.reduce((a, b) => a + b, 0);
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min': return Math.min(...values);
    case 'max': return Math.max(...values);
    case 'product': return values.reduce((a, b) => a * b, 1);
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    case 'stddev': {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
      return Math.sqrt(sq / values.length);
    }
  }
}

/** Iterate the snapshot, set each row as `crossRow`, evaluate the body, and
 *  collect finite results. Per-row evaluation errors are swallowed so one
 *  bad strike doesn't sink the whole fold. */
function foldStrikes(
  body: Expr, outerRow: OptionChainRow, ctx: EvalContext, fnName: string,
): number[] {
  const snap = requireSnapshot(ctx, fnName);
  const values: number[] = [];
  for (const crossRow of snap) {
    const innerCtx: InternalContext = { ...(ctx as InternalContext), crossRow };
    try {
      const v = evaluate(body, outerRow, innerCtx);
      if (Number.isFinite(v)) values.push(v);
    } catch { /* skip rows that error mid-fold */ }
  }
  return values;
}

const NOT_YET = (fn: string, phase: 'Phase 2' | 'Phase 3'): BuiltinImpl => () => {
  throw new Error(`${fn}() is coming in ${phase}. The runtime support hasn't shipped yet.`);
};

const BUILTINS: Record<string, BuiltinImpl> = {
  // ── Math: single number (Live) ──
  abs:   (a, r, c) => Math.abs(ev(a[0], r, c)),
  round: (a, r, c) => Math.round(ev(a[0], r, c)),
  floor: (a, r, c) => Math.floor(ev(a[0], r, c)),
  ceil:  (a, r, c) => Math.ceil(ev(a[0], r, c)),
  sqrt:  (a, r, c) => Math.sqrt(ev(a[0], r, c)),
  pow:   (a, r, c) => Math.pow(ev(a[0], r, c), ev(a[1], r, c)),
  log:   (a, r, c) => Math.log(ev(a[0], r, c)),
  exp:   (a, r, c) => Math.exp(ev(a[0], r, c)),
  sign:  (a, r, c) => Math.sign(ev(a[0], r, c)),

  // ── Math: many numbers (variadic) ──
  min: (a, r, c) => Math.min(...a.map((x) => ev(x, r, c))),
  max: (a, r, c) => Math.max(...a.map((x) => ev(x, r, c))),
  sum: (a, r, c) => aggregate(a.map((x) => ev(x, r, c)), 'sum'),
  avg: (a, r, c) => aggregate(a.map((x) => ev(x, r, c)), 'avg'),
  median:   (a, r, c) => aggregate(a.map((x) => ev(x, r, c)), 'median'),
  stddev:   (a, r, c) => aggregate(a.map((x) => ev(x, r, c)), 'stddev'),
  variance: (a, r, c) => {
    const vs = a.map((x) => ev(x, r, c));
    const sd = aggregate(vs, 'stddev');
    return sd * sd;
  },
  range:   (a, r, c) => {
    const vs = a.map((x) => ev(x, r, c));
    return Math.max(...vs) - Math.min(...vs);
  },
  product: (a, r, c) => a.reduce((acc, x) => acc * ev(x, r, c), 1),

  // ── Math: adjustment ──
  clamp: (a, r, c) => {
    const x = ev(a[0], r, c);
    const lo = ev(a[1], r, c);
    const hi = ev(a[2], r, c);
    return Math.min(Math.max(x, lo), hi);
  },
  lerp: (a, r, c) => {
    const aa = ev(a[0], r, c);
    const bb = ev(a[1], r, c);
    const t = ev(a[2], r, c);
    return aa + (bb - aa) * t;
  },

  // ── Logic ──
  ifelse: (a, r, c) => ev(a[0], r, c) ? ev(a[1], r, c) : ev(a[2], r, c),
  any: (a, r, c) => a.some((x) => ev(x, r, c)) ? 1 : 0,
  all: (a, r, c) => a.every((x) => ev(x, r, c)) ? 1 : 0,
  count: (a, r, c) => a.reduce((n, x) => n + (ev(x, r, c) ? 1 : 0), 0),

  // ── Cross-strike: pick one ──
  atStrike: (a, r, c) => {
    const target = readFieldOrColumnRef(a[0], r, c);
    const targetStrike = ev(a[1], r, c);
    const snap = requireSnapshot(c, 'atStrike');
    const found = snap.find((row) => row.strikePrice === targetStrike);
    return found ? readTargetAt(target, found, c) : NaN;
  },
  atOffset: (a, r, c) => {
    const target = readFieldOrColumnRef(a[0], r, c);
    const offset = ev(a[1], r, c);
    const snap = requireSnapshot(c, 'atOffset');
    const idx = snap.findIndex((row) => row.strikePrice === r.strikePrice);
    if (idx < 0) return NaN;
    const targetRow = snap[idx + offset];
    return targetRow ? readTargetAt(target, targetRow, c) : NaN;
  },
  atm: (a, r, c) => {
    const target = readFieldOrColumnRef(a[0], r, c);
    const snap = requireSnapshot(c, 'atm');
    if (snap.length === 0) return NaN;
    const spot = snap[0].underlyingValue;
    let best = snap[0];
    let bestDist = Math.abs(snap[0].strikePrice - spot);
    for (const row of snap) {
      const d = Math.abs(row.strikePrice - spot);
      if (d < bestDist) { best = row; bestDist = d; }
    }
    return readTargetAt(target, best, c);
  },

  // ── Cross-strike: aggregate over all ──
  sumStrikes:    (a, r, c) => aggregate(crossSeries(a, r, c, 'sumStrikes'), 'sum'),
  avgStrikes:    (a, r, c) => aggregate(crossSeries(a, r, c, 'avgStrikes'), 'avg'),
  medianStrikes: (a, r, c) => aggregate(crossSeries(a, r, c, 'medianStrikes'), 'median'),
  minStrikes:    (a, r, c) => aggregate(crossSeries(a, r, c, 'minStrikes'), 'min'),
  maxStrikes:    (a, r, c) => aggregate(crossSeries(a, r, c, 'maxStrikes'), 'max'),
  stddevStrikes: (a, r, c) => aggregate(crossSeries(a, r, c, 'stddevStrikes'), 'stddev'),

  // ── Cross-strike: ranking ──
  rank: (a, r, c) => {
    const target = readFieldOrColumnRef(a[0], r, c);
    const snap = requireSnapshot(c, 'rank');
    const here = readTargetAt(target, r, c);
    // Descending rank: #1 = highest.
    let pos = 1;
    for (const row of snap) {
      if (row.strikePrice === r.strikePrice) continue;
      if (readTargetAt(target, row, c) > here) pos++;
    }
    return pos;
  },
  pctile: (a, r, c) => {
    const target = readFieldOrColumnRef(a[0], r, c);
    const snap = requireSnapshot(c, 'pctile');
    if (snap.length === 0) return NaN;
    const here = readTargetAt(target, r, c);
    let below = 0;
    for (const row of snap) if (readTargetAt(target, row, c) < here) below++;
    return (below / snap.length) * 100;
  },
  topN: (a, r, c) => {
    const target = readFieldOrColumnRef(a[0], r, c);
    const n = ev(a[1], r, c);
    const snap = requireSnapshot(c, 'topN');
    const sorted = [...snap].sort((x, y) => readTargetAt(target, y, c) - readTargetAt(target, x, c));
    const slice = sorted.slice(0, Math.max(0, Math.floor(n)));
    return slice.some((row) => row.strikePrice === r.strikePrice) ? 1 : 0;
  },
  bottomN: (a, r, c) => {
    const target = readFieldOrColumnRef(a[0], r, c);
    const n = ev(a[1], r, c);
    const snap = requireSnapshot(c, 'bottomN');
    const sorted = [...snap].sort((x, y) => readTargetAt(target, x, c) - readTargetAt(target, y, c));
    const slice = sorted.slice(0, Math.max(0, Math.floor(n)));
    return slice.some((row) => row.strikePrice === r.strikePrice) ? 1 : 0;
  },

  // ── Cross-strike: fold expression over all strikes ──
  // These take an ARBITRARY expression (not just a fieldRef) and evaluate it
  // once per strike with `cross_*` fields bound to that strike's data. The
  // outer-row context still resolves plain field reads. Max-pain shape:
  //   sumOverStrikes(abs(cross_strikePrice - strikePrice)
  //     * (cross_strikePrice > strikePrice ? cross_put_oi : cross_call_oi))
  sumOverStrikes:     (a, r, c) => aggregate(foldStrikes(a[0], r, c, 'sumOverStrikes'), 'sum'),
  avgOverStrikes:     (a, r, c) => aggregate(foldStrikes(a[0], r, c, 'avgOverStrikes'), 'avg'),
  productOverStrikes: (a, r, c) => aggregate(foldStrikes(a[0], r, c, 'productOverStrikes'), 'product'),
  maxOverStrikes:     (a, r, c) => aggregate(foldStrikes(a[0], r, c, 'maxOverStrikes'), 'max'),
  minOverStrikes:     (a, r, c) => aggregate(foldStrikes(a[0], r, c, 'minOverStrikes'), 'min'),
  medianOverStrikes:  (a, r, c) => aggregate(foldStrikes(a[0], r, c, 'medianOverStrikes'), 'median'),
  countOverStrikes:   (a, r, c) => {
    const snap = requireSnapshot(c, 'countOverStrikes');
    let n = 0;
    for (const crossRow of snap) {
      const innerCtx: InternalContext = { ...(c as InternalContext), crossRow };
      try {
        const v = evaluate(a[0], r, innerCtx);
        if (Number.isFinite(v) && v !== 0) n++;
      } catch { /* skip */ }
    }
    return n;
  },

  // ── Recent history (Phase 2 stubs) ──
  prev:           NOT_YET('prev', 'Phase 2'),
  change:         NOT_YET('change', 'Phase 2'),
  pchange:        NOT_YET('pchange', 'Phase 2'),
  windowAvg:      NOT_YET('windowAvg', 'Phase 2'),
  windowSum:      NOT_YET('windowSum', 'Phase 2'),
  windowMin:      NOT_YET('windowMin', 'Phase 2'),
  windowMax:      NOT_YET('windowMax', 'Phase 2'),
  windowMedian:   NOT_YET('windowMedian', 'Phase 2'),
  windowStddev:   NOT_YET('windowStddev', 'Phase 2'),
  windowFirst:    NOT_YET('windowFirst', 'Phase 2'),
  windowLast:     NOT_YET('windowLast', 'Phase 2'),
  windowRange:    NOT_YET('windowRange', 'Phase 2'),
  windowCount:    NOT_YET('windowCount', 'Phase 2'),
  crossedAbove:   NOT_YET('crossedAbove', 'Phase 2'),
  crossedBelow:   NOT_YET('crossedBelow', 'Phase 2'),
  trendUp:        NOT_YET('trendUp', 'Phase 2'),
  trendDown:      NOT_YET('trendDown', 'Phase 2'),
  velocity:       NOT_YET('velocity', 'Phase 2'),

  // ── Past days (Phase 3 stubs) ──
  eod:                 NOT_YET('eod', 'Phase 3'),
  sessionOpen:         NOT_YET('sessionOpen', 'Phase 3'),
  sessionClose:        NOT_YET('sessionClose', 'Phase 3'),
  sessionHigh:         NOT_YET('sessionHigh', 'Phase 3'),
  sessionLow:          NOT_YET('sessionLow', 'Phase 3'),
  yesterdayAvg:        NOT_YET('yesterdayAvg', 'Phase 3'),
  daysAgoAvg:          NOT_YET('daysAgoAvg', 'Phase 3'),
  nDayAvg:             NOT_YET('nDayAvg', 'Phase 3'),
  nDayHigh:            NOT_YET('nDayHigh', 'Phase 3'),
  nDayLow:             NOT_YET('nDayLow', 'Phase 3'),
  rangeMin:            NOT_YET('rangeMin', 'Phase 3'),
  rangeMax:            NOT_YET('rangeMax', 'Phase 3'),
  compareToYesterday:  NOT_YET('compareToYesterday', 'Phase 3'),
  historical:          NOT_YET('historical', 'Phase 3'),
};

/** Map every strike to its value of the target (raw field or saved column). */
function crossSeries(args: Expr[], row: OptionChainRow, ctx: EvalContext, fnName: string): number[] {
  const target = readFieldOrColumnRef(args[0], row, ctx);
  const snap = requireSnapshot(ctx, fnName);
  return snap.map((r) => readTargetAt(target, r, ctx));
}

// ─────── Public evaluator ───────

export function evaluate(expr: Expr, row: OptionChainRow, ctx: EvalContext = EMPTY_CTX): number {
  switch (expr.kind) {
    case 'num': return expr.value;
    case 'const': return CONSTS[expr.name];
    case 'field': {
      const v = row[expr.name];
      (ctx as InternalContext)._trace?.({ field: expr.name, value: v });
      return v;
    }
    case 'fieldLit':
      // Reaching a fieldLit during plain evaluation means the caller used a
      // field-name token in a numeric position. That's a bug — fieldLits only
      // make sense as arguments to functions that consume them as references.
      throw new Error(
        `Field name "${expr.name}" was used as a value here. It can only appear as the field argument of a function like windowAvg(${expr.name}, 1m).`,
      );
    case 'crossField': {
      const cross = (ctx as InternalContext).crossRow;
      if (!cross) {
        throw new Error(
          `cross_${expr.name} can only be used inside a *OverStrikes(...) function (e.g. sumOverStrikes, avgOverStrikes).`,
        );
      }
      // Cross-field reads do NOT trace — the trace exists to drive cell
      // tinting on the OUTER row, and cross-strike reads are about OTHER
      // rows. A rule that purely sums cross fields tints nothing.
      return cross[expr.name];
    }
    case 'columnRef': {
      // Two resolution paths:
      //   1. Precomputed cached value (engine's two-pass compute) — fastest.
      //   2. Live recursive evaluation via `compiledColumns` — fallback for
      //      ad-hoc callers (modal previews, dry-runs) with no pre-built
      //      values table.
      //
      // We deliberately do NOT pass the field-trace sink into the recursive
      // evaluation: the column's body may read raw fields like
      // `strikePrice`, but those are implementation details of the column,
      // not what the rule consulted. The rule consulted the COLUMN itself
      // — that's what we report via `_traceColumn` and what drives
      // column-cell tinting. Without this isolation, a rule like
      // `maxPain == minStrikes(maxPain)` would tint whatever raw field
      // maxPain happens to read on the outer row, surprising the user.
      const ictx = ctx as InternalContext;
      let value: number;
      const cached = ctx.columnValues?.get(expr.id)?.get(row.strikePrice);
      if (cached !== undefined) {
        value = cached;
      } else if (ictx.compiledColumns) {
        const subAst = ictx.compiledColumns.get(expr.id);
        if (subAst) {
          // Strip trace sinks from the child context so the column body
          // doesn't leak field reads into the outer rule's trace.
          const noTraceCtx: InternalContext = {
            ...ictx,
            _trace: undefined,
            _traceColumn: undefined,
          };
          value = evaluate(subAst, row, noTraceCtx);
        } else {
          value = NaN;
        }
      } else {
        value = NaN;
      }
      ictx._traceColumn?.({ columnId: expr.id, columnName: expr.name, value });
      return value;
    }
    case 'crossColumnRef': {
      const cross = (ctx as InternalContext).crossRow;
      if (!cross) {
        throw new Error(
          `cross_${expr.name} can only be used inside a *OverStrikes(...) function.`,
        );
      }
      // Cross-column reads do NOT trace — same reasoning as crossField.
      // Otherwise mirror the columnRef fallback chain: cached value first,
      // then live recursive eval on the cross row via compiledColumns.
      const cached = ctx.columnValues?.get(expr.id)?.get(cross.strikePrice);
      if (cached !== undefined) return cached;
      const ictx = ctx as InternalContext;
      if (ictx.compiledColumns) {
        const subAst = ictx.compiledColumns.get(expr.id);
        if (subAst) return evaluate(subAst, cross, ctx);
      }
      return NaN;
    }
    case 'unresolvedIdent':
      throw new Error(
        `Identifier "${expr.cross ? `cross_${expr.name}` : expr.name}" was never resolved. Did you forget to call resolveColumnRefs after parseExpressionLoose?`,
      );
    case 'duration':
      throw new Error(`Duration "${expr.literal}" cannot be used as a number.`);
    case 'stringLit':
      throw new Error(`String "${expr.value}" cannot be used as a number.`);
    case 'unary': {
      const v = evaluate(expr.arg, row, ctx);
      switch (expr.op) {
        case '-': return -v;
        case '+': return +v;
        case '!': return v ? 0 : 1;
      }
      break;
    }
    case 'binary': {
      const l = evaluate(expr.left, row, ctx);
      if (expr.op === '&&') return l ? (evaluate(expr.right, row, ctx) ? 1 : 0) : 0;
      if (expr.op === '||') return l ? 1 : (evaluate(expr.right, row, ctx) ? 1 : 0);
      const r = evaluate(expr.right, row, ctx);
      switch (expr.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? NaN : l / r;
        case '%': return r === 0 ? NaN : l % r;
        case '>': return l > r ? 1 : 0;
        case '<': return l < r ? 1 : 0;
        case '>=': return l >= r ? 1 : 0;
        case '<=': return l <= r ? 1 : 0;
        case '==': return l === r ? 1 : 0;
        case '!=': return l !== r ? 1 : 0;
      }
      break;
    }
    case 'ternary': {
      const c = evaluate(expr.cond, row, ctx);
      return c ? evaluate(expr.whenTrue, row, ctx) : evaluate(expr.whenFalse, row, ctx);
    }
    case 'call': {
      const impl = BUILTINS[expr.name];
      if (!impl) throw new Error(`No implementation for "${expr.name}()"`);
      return impl(expr.args, row, ctx);
    }
  }
  throw new Error('Unhandled expression node');
}

// ─────── Pretty-printer (AST → string) ───────
//
// Used by hover tooltips, the builder UI's "raw expression" view, and any
// other surface that needs to render the formula. Round-trip with the parser
// up to whitespace.

const BINOP_PREC: Record<BinaryOp, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '>': 4, '<': 4, '>=': 4, '<=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

export function formatExpr(expr: Expr, parentPrec = 0): string {
  switch (expr.kind) {
    case 'num': return String(expr.value);
    case 'const': return expr.name;
    case 'field': return expr.name;
    case 'fieldLit': return expr.name;
    case 'crossField': return `cross_${expr.name}`;
    case 'columnRef': return expr.name;
    case 'crossColumnRef': return `cross_${expr.name}`;
    case 'unresolvedIdent': return expr.cross ? `cross_${expr.name}` : expr.name;
    case 'duration': return expr.literal;
    case 'stringLit': return `'${expr.value}'`;
    case 'unary': return `${expr.op}${formatExpr(expr.arg, 7)}`;
    case 'binary': {
      const prec = BINOP_PREC[expr.op];
      const s = `${formatExpr(expr.left, prec)} ${expr.op} ${formatExpr(expr.right, prec + 1)}`;
      return prec < parentPrec ? `(${s})` : s;
    }
    case 'ternary':
      return `${formatExpr(expr.cond, 0)} ? ${formatExpr(expr.whenTrue, 0)} : ${formatExpr(expr.whenFalse, 0)}`;
    case 'call':
      return `${expr.name}(${expr.args.map((a) => formatExpr(a, 0)).join(', ')})`;
  }
}

// ─────── Multi-line pretty-printer ───────
//
// Verbose form: every function call breaks onto its own block (each arg on a
// separate line, closing paren on its own at the parent indent). Top-level
// `||` / `&&` also break onto separate lines. Comparisons and arithmetic
// stay inline.

const INDENT = '  ';

export function formatExprMultiline(expr: Expr, indent = 0, parentPrec = 0): string {
  const pad = INDENT.repeat(indent);
  switch (expr.kind) {
    case 'num': case 'const': case 'field': case 'fieldLit':
    case 'crossField': case 'columnRef': case 'crossColumnRef':
    case 'unresolvedIdent': case 'duration': case 'stringLit':
      return formatExpr(expr, parentPrec);

    case 'unary':
      return `${expr.op}${formatExprMultiline(expr.arg, indent, 7)}`;

    case 'binary': {
      const prec = BINOP_PREC[expr.op];
      // Only top-level || / && break onto rows.
      if ((expr.op === '||' || expr.op === '&&') && indent === 0) {
        const operands = collectLogicalChain(expr);
        const lines = operands.map((o, i) => {
          const body = formatExprMultiline(o, indent, prec);
          return i === 0 ? body : `${pad}${expr.op} ${body}`;
        });
        return lines.join('\n');
      }
      const inline = `${formatExprMultiline(expr.left, indent, prec)} ${expr.op} ${formatExprMultiline(expr.right, indent, prec + 1)}`;
      return prec < parentPrec ? `(${inline})` : inline;
    }

    case 'ternary':
      return `${formatExprMultiline(expr.cond, indent, 0)} ? ${formatExprMultiline(expr.whenTrue, indent, 0)} : ${formatExprMultiline(expr.whenFalse, indent, 0)}`;

    case 'call': {
      const childIndent = indent + 1;
      const childPad = INDENT.repeat(childIndent);
      const args = expr.args.map((a) => `${childPad}${formatExprMultiline(a, childIndent, 0)}`).join(',\n');
      return `${expr.name}(\n${args}\n${pad})`;
    }
  }
}

/** Flatten a chain of same-op logical binaries into a list, for prettier
 *  multi-line layout. `a || b || c` → `[a, b, c]`. */
function collectLogicalChain(node: Expr): Expr[] {
  const op = node.kind === 'binary' ? node.op : null;
  if (op !== '||' && op !== '&&') return [node];
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

// ─────── Trace evaluator (live values for hover proof + cell tinting) ───────

export interface EvalTrace {
  value: number;
  /** Numeric fields actually read on the outer row. Respects `&&`/`||`
   *  short-circuit + ternary branch selection. De-duplicated; order is
   *  first-seen. Cross-strike + column-internal reads do not appear here. */
  fieldValues: Array<{ field: NumericField; value: number }>;
  /** Saved columns the rule consulted on the outer row. Each entry is
   *  reported once even if referenced multiple times. Drives column-cell
   *  tinting in the table (the cell under that column for this strike
   *  picks up the rule's hue). */
  columnValues: Array<{ columnId: string; columnName: string; value: number }>;
}

export function evaluateWithTrace(
  expr: Expr, row: OptionChainRow, ctx: EvalContext = EMPTY_CTX,
): EvalTrace {
  const seenFields = new Set<NumericField>();
  const fieldValues: EvalTrace['fieldValues'] = [];
  const seenColumns = new Set<string>();
  const columnValues: EvalTrace['columnValues'] = [];
  const innerCtx: InternalContext = {
    ...ctx,
    _trace: (read) => {
      if (!seenFields.has(read.field)) {
        seenFields.add(read.field);
        fieldValues.push(read);
      }
    },
    _traceColumn: (read) => {
      if (!seenColumns.has(read.columnId)) {
        seenColumns.add(read.columnId);
        columnValues.push(read);
      }
    },
  };
  const value = evaluate(expr, row, innerCtx);
  return { value, fieldValues, columnValues };
}
