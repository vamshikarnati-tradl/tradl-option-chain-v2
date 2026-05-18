import { NUMERIC_FIELDS, type NumericField } from './fields.js';
import {
  getFunction, arityOf, durationToMs, HISTORICAL_AGGS,
  type ArgKind,
} from './function-catalog.js';

// ─────── AST ───────
//
// `fieldLit` carries a field name as a token, not as a value read from the
// current row. Used for arguments to snapshot/history functions, e.g. the
// first arg of windowAvg(call_oi, 1m) — the function looks up history by
// (strike, field), so the field name must arrive un-evaluated.
//
// `duration` carries a window literal like '5m' verbatim. The tokenizer
// validates it against the allow-list at parse time.
//
// `stringLit` carries a quoted string — used today only by historical(field,
// range, agg) for the agg enum, but kept generic.

/** Source-text range attached to every AST node. Half-open: `[start, end)`. */
export interface NodeRange {
  start?: number;
  end?: number;
}

export type Expr =
  | (NodeRange & { kind: 'num'; value: number })
  | (NodeRange & { kind: 'const'; name: 'PI' | 'E' })
  | (NodeRange & { kind: 'field'; name: NumericField })
  | (NodeRange & { kind: 'fieldLit'; name: NumericField })
  | (NodeRange & { kind: 'crossField'; name: NumericField })
  | (NodeRange & { kind: 'columnRef'; id: string; name: string })
  | (NodeRange & { kind: 'crossColumnRef'; id: string; name: string })
  | (NodeRange & { kind: 'unresolvedIdent'; name: string; cross: boolean })
  | (NodeRange & { kind: 'duration'; literal: string })
  | (NodeRange & { kind: 'stringLit'; value: string })
  | (NodeRange & { kind: 'unary'; op: '-' | '+' | '!'; arg: Expr })
  | (NodeRange & { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr })
  | (NodeRange & { kind: 'ternary'; cond: Expr; whenTrue: Expr; whenFalse: Expr })
  | (NodeRange & { kind: 'call'; name: BuiltinFn; args: Expr[] });

/** Prefix that turns a field name into an iterated-strike reference. Inside a
 *  `pivot*(expression)` call, `strike_call_oi` reads from the strike
 *  currently being iterated over, while plain `call_oi` reads from the outer
 *  row. Outside such a call, evaluating a `crossField` throws.
 *
 *  Note: the legacy `cross_` prefix is still accepted at parse time so old
 *  saved expressions keep working (persistence migration rewrites them to
 *  `strike_`). The canonical spelling everywhere new is `strike_`. */
export const STRIKE_FIELD_PREFIX = 'strike_';
/** Legacy alias. Treated identically by the parser. */
export const CROSS_FIELD_PREFIX = 'cross_';

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '>' | '<' | '>=' | '<=' | '==' | '!='
  | '&&' | '||';

/**
 * Function names accepted by the parser. Dynamic — driven by the function
 * catalog, validated per-call. Kept as a plain string for that reason.
 */
export type BuiltinFn = string;

const FIELD_SET: ReadonlySet<string> = new Set(NUMERIC_FIELDS);

// ─────── Tokenizer ───────

type TokenType =
  | 'num' | 'ident' | 'duration' | 'str'
  | '+' | '-' | '*' | '/' | '%' | '(' | ')' | ','
  | '>' | '<' | '>=' | '<=' | '==' | '!=' | '!' | '&&' | '||'
  | '?' | ':' | 'eof';

interface Token {
  type: TokenType;
  value?: string | number;
  /** Char position where the token starts (inclusive). */
  pos: number;
  /** Char position one past the token's last character (exclusive). */
  endPos: number;
}

class Tokenizer {
  private i = 0;
  constructor(private src: string) {}

  next(): Token {
    this.skipWs();
    if (this.i >= this.src.length) return { type: 'eof', pos: this.i, endPos: this.i };
    const start = this.i;
    const c = this.src[this.i];

    // Numbers — and, if immediately followed by a duration suffix (no space),
    // fold into a single 'duration' token. So '5m' → duration, '5 * 2' → num.
    if (c >= '0' && c <= '9') {
      let s = '';
      while (this.i < this.src.length && /[0-9.]/.test(this.src[this.i])) {
        s += this.src[this.i++];
      }
      // Peek for a unit suffix.
      if (this.i < this.src.length && /[a-zA-Z]/.test(this.src[this.i])) {
        let suffix = '';
        while (this.i < this.src.length && /[a-zA-Z]/.test(this.src[this.i])) {
          suffix += this.src[this.i++];
        }
        const literal = s + suffix;
        if (durationToMs(literal) === null) {
          throw new Error(
            `Invalid duration literal "${literal}" at ${start}. ` +
            `Use one of: 1tick, 5s, 10s, 15s, 30s, 1m, 2m, 5m, 10m, 15m, 30m, 1h, 2h, 5h, 1d, 2d, 5d, 10d, 15d.`,
          );
        }
        return { type: 'duration', value: literal, pos: start, endPos: this.i };
      }
      const n = Number(s);
      if (!Number.isFinite(n)) throw new Error(`Invalid number "${s}" at ${start}`);
      return { type: 'num', value: n, pos: start, endPos: this.i };
    }

    // Identifiers (fields, constants, builtin fns).
    if (c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      let s = '';
      while (this.i < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.i])) {
        s += this.src[this.i++];
      }
      return { type: 'ident', value: s, pos: start, endPos: this.i };
    }

    // Quoted string literals — used for enum args like historical(…, 'AVG').
    if (c === "'" || c === '"') {
      const quote = c;
      this.i++;
      let s = '';
      while (this.i < this.src.length && this.src[this.i] !== quote) {
        s += this.src[this.i++];
      }
      if (this.i >= this.src.length) {
        throw new Error(`Unterminated string starting at ${start}`);
      }
      this.i++; // consume closing quote
      return { type: 'str', value: s, pos: start, endPos: this.i };
    }

    // Two-char operators.
    const two = this.src.slice(this.i, this.i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
      this.i += 2;
      return { type: two as TokenType, pos: start, endPos: this.i };
    }

    // Single-char.
    const single = '+-*/%()<>!,?:';
    if (single.includes(c)) {
      this.i++;
      return { type: c as TokenType, pos: start, endPos: this.i };
    }

    throw new Error(`Unexpected character "${c}" at ${start}`);
  }

  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++;
  }
}

// ─────── Parser (recursive descent) ───────
//
// Grammar (precedence low → high):
//   expr        = ternary
//   ternary     = logicalOr ( '?' ternary ':' ternary )?
//   logicalOr   = logicalAnd ( '||' logicalAnd )*
//   logicalAnd  = equality ( '&&' equality )*
//   equality    = comparison ( ('==' | '!=') comparison )*
//   comparison  = additive ( ('>' | '<' | '>=' | '<=') additive )*
//   additive    = multiplicative ( ('+' | '-') multiplicative )*
//   multiplicative = unary ( ('*' | '/' | '%') unary )*
//   unary       = ('-' | '+' | '!') unary | primary
//   primary     = NUMBER | DURATION | STRING | IDENT | IDENT '(' args ')' | '(' expr ')'

class Parser {
  private cur: Token;
  /** End position of the most recently consumed token. Used to stamp `end`
   *  on AST nodes built bottom-up. */
  private lastEndPos = 0;
  /** Loose mode emits `unresolvedIdent` for unknown identifiers instead of
   *  throwing — lets a downstream resolver (e.g. `resolveColumnRefs`)
   *  rewrite them into column references with the original char position
   *  preserved for error reporting. */
  loose = false;

  constructor(private tk: Tokenizer) {
    this.cur = tk.next();
  }

  parse(): Expr {
    const e = this.ternary();
    if (this.cur.type !== 'eof') {
      throw new Error(`Unexpected token "${this.cur.type}" at ${this.cur.pos}`);
    }
    return e;
  }

  private eat(type: TokenType): Token {
    if (this.cur.type !== type) {
      throw new Error(`Expected ${type} but got ${this.cur.type} at ${this.cur.pos}`);
    }
    const t = this.cur;
    this.lastEndPos = t.endPos;
    this.cur = this.tk.next();
    return t;
  }

  /** Stamp `start` + the current `lastEndPos` onto a freshly-built node. */
  private mark<T extends Expr>(node: T, start: number): T {
    node.start = start;
    node.end = this.lastEndPos;
    return node;
  }

  private ternary(): Expr {
    const start = this.cur.pos;
    const cond = this.logicalOr();
    if (this.cur.type === '?') {
      this.eat('?');
      const whenTrue = this.ternary();
      this.eat(':');
      const whenFalse = this.ternary();
      return this.mark({ kind: 'ternary', cond, whenTrue, whenFalse }, start);
    }
    return cond;
  }

  private logicalOr(): Expr {
    let left = this.logicalAnd();
    while (this.cur.type === '||') {
      this.eat('||');
      const right = this.logicalAnd();
      left = this.mark({ kind: 'binary', op: '||', left, right }, left.start ?? 0);
    }
    return left;
  }

  private logicalAnd(): Expr {
    let left = this.equality();
    while (this.cur.type === '&&') {
      this.eat('&&');
      const right = this.equality();
      left = this.mark({ kind: 'binary', op: '&&', left, right }, left.start ?? 0);
    }
    return left;
  }

  private equality(): Expr {
    let left = this.comparison();
    while (this.cur.type === '==' || this.cur.type === '!=') {
      const op = this.cur.type as '==' | '!=';
      this.eat(op);
      const right = this.comparison();
      left = this.mark({ kind: 'binary', op, left, right }, left.start ?? 0);
    }
    return left;
  }

  private comparison(): Expr {
    let left = this.additive();
    while (
      this.cur.type === '>' || this.cur.type === '<' ||
      this.cur.type === '>=' || this.cur.type === '<='
    ) {
      const op = this.cur.type as '>' | '<' | '>=' | '<=';
      this.eat(op);
      const right = this.additive();
      left = this.mark({ kind: 'binary', op, left, right }, left.start ?? 0);
    }
    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.cur.type === '+' || this.cur.type === '-') {
      const op = this.cur.type as '+' | '-';
      this.eat(op);
      const right = this.multiplicative();
      left = this.mark({ kind: 'binary', op, left, right }, left.start ?? 0);
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.cur.type === '*' || this.cur.type === '/' || this.cur.type === '%') {
      const op = this.cur.type as '*' | '/' | '%';
      this.eat(op);
      const right = this.unary();
      left = this.mark({ kind: 'binary', op, left, right }, left.start ?? 0);
    }
    return left;
  }

  private unary(): Expr {
    if (this.cur.type === '-' || this.cur.type === '+' || this.cur.type === '!') {
      const start = this.cur.pos;
      const op = this.cur.type as '-' | '+' | '!';
      this.eat(op);
      const arg = this.unary();
      return this.mark({ kind: 'unary', op, arg }, start);
    }
    return this.primary();
  }

  private primary(): Expr {
    if (this.cur.type === 'num') {
      const t = this.cur;
      this.eat('num');
      return this.mark({ kind: 'num', value: t.value as number }, t.pos);
    }
    if (this.cur.type === 'duration') {
      const t = this.cur;
      this.eat('duration');
      return this.mark({ kind: 'duration', literal: t.value as string }, t.pos);
    }
    if (this.cur.type === 'str') {
      const t = this.cur;
      this.eat('str');
      return this.mark({ kind: 'stringLit', value: t.value as string }, t.pos);
    }
    if (this.cur.type === '(') {
      const start = this.cur.pos;
      this.eat('(');
      const e = this.ternary();
      this.eat(')');
      // Re-stamp the wrapped expression's range to include the parens.
      // Keeps inner node ranges intact but lets callers measure the
      // paren-delimited extent if they need it later.
      e.start = start;
      e.end = this.lastEndPos;
      return e;
    }
    if (this.cur.type === 'ident') {
      const name = this.cur.value as string;
      const pos = this.cur.pos;
      this.eat('ident');

      // Function call.
      if ((this.cur as Token).type === '(') {
        this.eat('(');
        const args: Expr[] = [];
        if ((this.cur as Token).type !== ')') {
          args.push(this.ternary());
          while ((this.cur as Token).type === ',') {
            this.eat(',');
            args.push(this.ternary());
          }
        }
        this.eat(')');

        const spec = getFunction(name);
        if (!spec) throw new Error(`Unknown function "${name}" at ${pos}`);

        const [minA, maxA] = arityOf(spec);
        if (args.length < minA || args.length > maxA) {
          const maxStr = maxA === Infinity ? `${minA}+` : minA === maxA ? `${minA}` : `${minA}..${maxA}`;
          throw new Error(
            `${name}() expects ${maxStr} arg${maxA === 1 ? '' : 's'}, got ${args.length} at ${pos}`,
          );
        }

        // Per-arg kind check. Trailing optional scope slot (only when the
        // function opts in via acceptsScope) is validated as kind='scope'.
        for (let i = 0; i < args.length; i++) {
          let argKind: ArgKind;
          if (i < spec.args.length) {
            argKind = spec.args[i].kind;
          } else if (spec.acceptsScope && i === spec.args.length) {
            argKind = 'scope';
          } else if (spec.rest) {
            argKind = spec.rest.kind;
          } else {
            // shouldn't happen given arity check above
            argKind = 'expression';
          }
          validateArg(name, i, argKind, args, pos);
        }

        // scope(predicate): predicate must yield boolean (same rule as the
        // rule root). Statically enforced from the AST root kind + the
        // function catalog. We accept loose-mode unresolved idents here too
        // since the resolver may still rewrite them.
        if (name === 'scope' && args.length === 1) {
          const pred = args[0];
          if (pred.kind !== 'unresolvedIdent' && !returnsBoolean(pred)) {
            throw new Error(
              `scope() predicate must be a boolean condition (e.g. strike_call_oi > 50000). It can't be a numeric expression. At ${pos}.`,
            );
          }
        }

        return this.mark({ kind: 'call', name, args }, pos);
      }

      // Constant or field ref.
      if (name === 'PI' || name === 'E') {
        return this.mark({ kind: 'const', name }, pos);
      }
      if (FIELD_SET.has(name)) {
        return this.mark({ kind: 'field', name: name as NumericField }, pos);
      }
      // Accept both the canonical `strike_` prefix and the legacy `cross_`
      // alias. Persistence migrates old saved expressions to `strike_`; this
      // dual-accept keeps in-flight expressions and any unmigrated callers
      // working.
      const strikePrefix = name.startsWith(STRIKE_FIELD_PREFIX)
        ? STRIKE_FIELD_PREFIX
        : name.startsWith(CROSS_FIELD_PREFIX) ? CROSS_FIELD_PREFIX : null;
      if (strikePrefix !== null) {
        const baseName = name.slice(strikePrefix.length);
        if (FIELD_SET.has(baseName)) {
          return this.mark({ kind: 'crossField', name: baseName as NumericField }, pos);
        }
        // Unknown after the strike_ prefix. In loose mode the resolver gets
        // a chance to rewrite this into a crossColumnRef. In strict mode we
        // throw at parse time (current behavior).
        if (this.loose) {
          return this.mark({ kind: 'unresolvedIdent', name: baseName, cross: true }, pos);
        }
        throw new Error(
          `Unknown strike-field "${name}" at ${pos}. The part after "strike_" must be a known field (e.g. strike_call_oi, strike_strikePrice).`,
        );
      }
      // Unknown bare identifier. Loose mode defers — the resolver decides if
      // it's a column reference. Strict mode throws.
      if (this.loose) {
        return this.mark({ kind: 'unresolvedIdent', name, cross: false }, pos);
      }
      throw new Error(`Unknown identifier "${name}" at ${pos}`);
    }
    throw new Error(`Unexpected token "${this.cur.type}" at ${this.cur.pos}`);
  }
}

/**
 * Catalog-driven argument validation. Mutates `args` in place to fold field
 * refs into fieldLit nodes when the slot demands it.
 */
function validateArg(
  fnName: string, idx: number, kind: ArgKind, args: Expr[], pos: number,
): void {
  const arg = args[idx];
  const argLabel = `argument ${idx + 1} of ${fnName}()`;
  switch (kind) {
    case 'expression':
      return; // any sub-expression is fine
    case 'fieldRef': {
      // Three forms accepted:
      //   1. A raw field name → fold to `fieldLit` here.
      //   2. A `columnRef` (resolved by an earlier pass) → leave as-is; the
      //      evaluator's `readFieldOrColumnRef` reads from columnValues.
      //   3. An `unresolvedIdent` from loose-parse mode → leave it; the
      //      downstream `resolveColumnRefs` pass either upgrades it to a
      //      `columnRef` (if a saved column has that name) or throws
      //      "Unknown identifier" with the original char position. Strict
      //      `parseExpression` can never produce an `unresolvedIdent`, so
      //      this branch only matters for the column-aware compile path.
      if (arg.kind === 'field') {
        args[idx] = { kind: 'fieldLit', name: arg.name };
        return;
      }
      if (arg.kind === 'columnRef' || arg.kind === 'unresolvedIdent') {
        return;
      }
      throw new Error(`${argLabel} must be a field name or saved column (at ${pos})`);
    }
    case 'duration': {
      if (arg.kind !== 'duration') {
        throw new Error(`${argLabel} must be a duration literal like 5s, 1m, 1d (at ${pos})`);
      }
      return;
    }
    case 'integer': {
      if (arg.kind !== 'num' || !Number.isInteger(arg.value)) {
        throw new Error(`${argLabel} must be an integer literal (at ${pos})`);
      }
      return;
    }
    case 'historicalAgg': {
      if (arg.kind !== 'stringLit') {
        throw new Error(`${argLabel} must be a quoted aggregation name like 'AVG' (at ${pos})`);
      }
      if (!(HISTORICAL_AGGS as readonly string[]).includes(arg.value)) {
        throw new Error(
          `${argLabel}: "${arg.value}" is not a valid aggregation. ` +
          `Allowed: ${HISTORICAL_AGGS.join(', ')} (at ${pos})`,
        );
      }
      return;
    }
    case 'scope': {
      // The scope slot must be a `scope(<predicate>)` call. We don't try to
      // recover by rewriting an expression into a scope — users get a clear
      // error so the type is explicit at the call site.
      if (arg.kind !== 'call' || arg.name !== 'scope') {
        throw new Error(
          `${argLabel} must be a scope(<predicate>) call. Wrap your filter in scope(...) (at ${pos}).`,
        );
      }
      return;
    }
    case 'strikeRef': {
      // The strikeRef slot accepts any expression — evalAt expects a number
      // (the strike price), which can come from firstStrike/lastStrike/onlyStrike,
      // a constant, atStrike-of-something, etc. Runtime checks the resulting
      // strike exists in the chain.
      return;
    }
  }
}

export function parseExpression(src: string): Expr {
  return new Parser(new Tokenizer(src)).parse();
}

/** Permissive parse that emits `unresolvedIdent` for unknown identifiers
 *  instead of throwing. Call `resolveColumnRefs` afterwards to rewrite them
 *  into column references, or throw the deferred "unknown identifier" error
 *  at the original source position. */
export function parseExpressionLoose(src: string): Expr {
  const p = new Parser(new Tokenizer(src));
  p.loose = true;
  return p.parse();
}

/** Walk the AST and rewrite `unresolvedIdent` nodes into `columnRef` /
 *  `crossColumnRef` nodes using the provided columns-by-name lookup. Any
 *  remaining `unresolvedIdent` is rejected with a clear error at the
 *  original source position. */
export function resolveColumnRefs(
  ast: Expr,
  columnsByName: ReadonlyMap<string, { id: string; name: string }>,
): Expr {
  const walk = (e: Expr): Expr => {
    switch (e.kind) {
      case 'unresolvedIdent': {
        const col = columnsByName.get(e.name);
        if (col) {
          const replacement: Expr = e.cross
            ? { kind: 'crossColumnRef', id: col.id, name: col.name, start: e.start, end: e.end }
            : { kind: 'columnRef',      id: col.id, name: col.name, start: e.start, end: e.end };
          return replacement;
        }
        const at = e.start !== undefined ? ` at ${e.start}` : '';
        const prefix = e.cross ? 'strike_' : '';
        throw new Error(`Unknown identifier "${prefix}${e.name}"${at}`);
      }
      case 'unary':
        return { ...e, arg: walk(e.arg) };
      case 'binary':
        return { ...e, left: walk(e.left), right: walk(e.right) };
      case 'ternary':
        return { ...e, cond: walk(e.cond), whenTrue: walk(e.whenTrue), whenFalse: walk(e.whenFalse) };
      case 'call':
        return { ...e, args: e.args.map(walk) };
      default:
        return e;
    }
  };
  return walk(ast);
}

// ─────── Boolean-root check ───────
//
// A rule's expression must produce true/false at the root. Static analysis
// based on the AST root kind + the function catalog's `returns` field.
// Used by the rule engine validator and the editor's inline status row.

const BOOLEAN_BINARY_OPS: ReadonlySet<BinaryOp> = new Set([
  '>', '<', '>=', '<=', '==', '!=',
  '&&', '||',
]);

export function returnsBoolean(expr: Expr): boolean {
  switch (expr.kind) {
    case 'binary': return BOOLEAN_BINARY_OPS.has(expr.op);
    case 'unary':  return expr.op === '!';
    case 'call': {
      const spec = getFunction(expr.name);
      return spec?.returns === 'boolean';
    }
    case 'ternary':
      return returnsBoolean(expr.whenTrue) && returnsBoolean(expr.whenFalse);
    case 'num':
    case 'const':
    case 'field':
    case 'fieldLit':
    case 'crossField':
    case 'columnRef':
    case 'crossColumnRef':
    case 'unresolvedIdent':
    case 'duration':
    case 'stringLit':
      return false;
  }
}

// ─────── Value/column root-type checks ───────
//
// A "value" artifact is a single-scalar expression — produced when:
//   1. The outermost operator is a chain* aggregator (or evalAt /
//      firstStrike / lastStrike / onlyStrike / atm / atStrike), AND
//   2. The expression contains NO outer-row field references anywhere.
//
// Field references that DON'T count as outer-row refs:
//   - `crossField` (strike_*) — only valid inside a pivot* body and refers
//     to the iterated strike.
//   - `field` references inside a chain* call's body — bound to the
//     iterated strike, not the outer row.
//   - `fieldLit` (bare token, not evaluated against any row).
//
// Field references that DO count as outer-row refs:
//   - `field` references outside any aggregator body.
//   - `field` references inside a pivot* body (those ARE outer-row reads —
//     pivot* by convention binds plain names to the outer row).
//   - Any `columnRef` outside an aggregator body / inside a pivot* body.

const VALUE_PRODUCING_FUNCTIONS: ReadonlySet<string> = new Set([
  'chainSum', 'chainAvg', 'chainMedian', 'chainMin', 'chainMax',
  'chainStddev', 'chainProduct', 'chainCount',
  'firstStrike', 'lastStrike', 'onlyStrike', 'evalAt',
  'atStrike', 'atm',
]);

const CHAIN_AGGREGATORS: ReadonlySet<string> = new Set([
  'chainSum', 'chainAvg', 'chainMedian', 'chainMin', 'chainMax',
  'chainStddev', 'chainProduct', 'chainCount',
]);

/** True iff the expression contains a plain field or column read that would
 *  bind to the OUTER row at evaluation time. Used by the value-vs-column
 *  classifier — values cannot have any outer-row references.
 *
 *  Binding rules per call:
 *    - chain*(<body>, [scope])       : body rebinds plain → iterated; scope body uses pivot binding (plain → outer)
 *    - pivot*(<body>, [scope])       : body uses pivot binding (plain → outer); scope body same
 *    - evalAt(<body>, <strikeRef>)   : body rebinds plain → iterated; strikeRef arg keeps caller binding
 *    - firstStrike/lastStrike/onlyStrike(<scope>) : scope body uses pivot binding
 *    - scope(<predicate>)            : predicate body uses pivot binding (plain → outer)
 *    - anything else                 : args inherit caller binding
 */
export function referencesOuterRow(expr: Expr): boolean {
  const walk = (e: Expr, inChainBody: boolean): boolean => {
    switch (e.kind) {
      case 'field':
      case 'columnRef':
        return !inChainBody;
      case 'crossField':
      case 'crossColumnRef':
      case 'fieldLit':
      case 'num': case 'const': case 'duration': case 'stringLit':
      case 'unresolvedIdent':
        return false;
      case 'unary':
        return walk(e.arg, inChainBody);
      case 'binary':
        return walk(e.left, inChainBody) || walk(e.right, inChainBody);
      case 'ternary':
        return walk(e.cond, inChainBody)
          || walk(e.whenTrue, inChainBody)
          || walk(e.whenFalse, inChainBody);
      case 'call': {
        const isChainRebind = CHAIN_AGGREGATORS.has(e.name) || e.name === 'evalAt';
        const isScope = e.name === 'scope';
        for (let i = 0; i < e.args.length; i++) {
          let childInChain: boolean;
          if (isScope) {
            // scope() predicate uses pivot binding (plain field = outer
            // row) regardless of where the scope sits. A scope reaching for
            // outer fields is intentional (anchor to the rendered row).
            childInChain = false;
          } else if (isChainRebind && i === 0) {
            // chain*/evalAt body rebinds plain field names to the iterated
            // strike. The body is always argument 0.
            childInChain = true;
          } else {
            childInChain = inChainBody;
          }
          if (walk(e.args[i], childInChain)) return true;
        }
        return false;
      }
    }
  };
  return walk(expr, false);
}

/** True iff the expression is a valid "value" artifact root — a single
 *  scalar, with no outer-row dependencies. */
export function returnsValue(expr: Expr): boolean {
  if (referencesOuterRow(expr)) return false;
  // Outermost must be either a value-producing call, a literal/constant, or
  // math/logic combining value-typed sub-expressions.
  switch (expr.kind) {
    case 'num': case 'const': return true;
    case 'call':
      return VALUE_PRODUCING_FUNCTIONS.has(expr.name)
        // Math/logic builtins are scalar if all args are — referencesOuterRow
        // already vetoed any outer-row leakage.
        || ['abs','round','floor','ceil','sqrt','pow','log','exp','sign',
            'min','max','sum','avg','median','stddev','variance','range','product',
            'clamp','lerp','ifelse','any','all','count'].includes(expr.name);
    case 'binary':
    case 'unary':
    case 'ternary':
      return true; // already passed referencesOuterRow
    default:
      return false;
  }
}

// ─────── Dependency extraction ───────
//
// Two functions: a simple one for backward compat (returns field names), and a
// rich one for the engine + storage planner that returns time and snapshot
// awareness alongside fields.

export function extractDependencies(expr: Expr): NumericField[] {
  return [...analyzeDependencies(expr).fields];
}

export interface IntradayDep {
  field: NumericField;
  /** The widest window observed for this field across all references. */
  maxWindow: string;
  maxWindowMs: number;
}

export interface HistoricalDep {
  field: NumericField;
  range: string;
  agg?: string; // 'EOD' / 'AVG' / ... — present for historical() calls
}

export interface AstDependencies {
  /** Plain field reads against the current row. */
  fields: NumericField[];
  /** Field references inside intraday-history functions, with their maximum window. */
  intraday: IntradayDep[];
  /** Field references inside backend-history functions. */
  historical: HistoricalDep[];
  /** Saved-column ids referenced anywhere in the expression (columnRef or
   *  crossColumnRef). Used by the engine to topologically order column
   *  computation + by the dependency-graph for cascade-delete. */
  columnRefs: string[];
  /** True if the expression touches snapshot-wide / cross-strike functions
   *  or any cross-column reference. */
  needsSnapshot: boolean;
  /** True if the expression uses any time-aware function (forces recompute every tick). */
  isTimeAware: boolean;
  /** True if any backend-history function is referenced. */
  isHistorical: boolean;
}

export function analyzeDependencies(expr: Expr): AstDependencies {
  const fieldSet = new Set<NumericField>();
  const intradayMap = new Map<string, IntradayDep>(); // key = field|window
  const historical: HistoricalDep[] = [];
  const columnRefSet = new Set<string>();
  let needsSnapshot = false;
  let isTimeAware = false;
  let isHistorical = false;

  const walk = (e: Expr): void => {
    switch (e.kind) {
      case 'field':
        fieldSet.add(e.name);
        return;
      case 'crossField':
        // Cross-fields reference the same underlying data field on a different
        // strike — track the field for global change-invalidation, and mark
        // the expression as snapshot-aware so the cache handles it correctly.
        fieldSet.add(e.name);
        needsSnapshot = true;
        return;
      case 'columnRef':
        columnRefSet.add(e.id);
        return;
      case 'crossColumnRef':
        columnRefSet.add(e.id);
        needsSnapshot = true;
        return;
      case 'unresolvedIdent':
        // Unresolved at analyze time — treat as a no-op. The caller is expected
        // to have already called `resolveColumnRefs`; any unresolved name
        // would have thrown.
        return;
      case 'unary':
        walk(e.arg);
        return;
      case 'binary':
        walk(e.left); walk(e.right);
        return;
      case 'ternary':
        walk(e.cond); walk(e.whenTrue); walk(e.whenFalse);
        return;
      case 'call': {
        const spec = getFunction(e.name);
        if (spec?.isSnapshotAware) needsSnapshot = true;
        if (spec?.isTimeAware) isTimeAware = true;
        if (spec?.isHistorical) isHistorical = true;

        // Intraday history dep: extract field + window from the spec's arg
        // shape. Convention: first arg is the fieldLit, second arg is the
        // duration. Pattern fns (crossedAbove, crossedBelow) have a numeric
        // threshold between them — we use the duration argument by position.
        if (spec?.isTimeAware && !spec.isHistorical) {
          const fieldArg = e.args[0];
          // Find the duration arg.
          const durArg = e.args.find((a) => a.kind === 'duration');
          if (fieldArg?.kind === 'fieldLit' && durArg?.kind === 'duration') {
            const key = `${fieldArg.name}|${durArg.literal}`;
            const ms = durationToMs(durArg.literal) ?? 0;
            const prev = intradayMap.get(key);
            if (!prev || ms > prev.maxWindowMs) {
              intradayMap.set(key, {
                field: fieldArg.name, maxWindow: durArg.literal, maxWindowMs: ms,
              });
            }
          }
        }

        // Backend historical dep.
        if (spec?.isHistorical) {
          const fieldArg = e.args[0];
          if (fieldArg?.kind === 'fieldLit') {
            const durArg = e.args.find((a) => a.kind === 'duration');
            const aggArg = e.args.find((a) => a.kind === 'stringLit');
            historical.push({
              field: fieldArg.name,
              range: durArg?.kind === 'duration' ? durArg.literal : '',
              agg: aggArg?.kind === 'stringLit' ? aggArg.value : undefined,
            });
          }
        }

        // Recurse into any sub-expressions that ARE numeric (skip fieldLit,
        // stringLit, duration — those are tokens, not exprs to evaluate).
        for (const a of e.args) {
          if (a.kind === 'fieldLit' || a.kind === 'stringLit' || a.kind === 'duration') continue;
          walk(a);
        }
        return;
      }
      case 'fieldLit':
      case 'duration':
      case 'stringLit':
      case 'num':
      case 'const':
        return;
    }
  };

  walk(expr);

  return {
    fields: [...fieldSet],
    intraday: [...intradayMap.values()],
    historical,
    columnRefs: [...columnRefSet],
    needsSnapshot,
    isTimeAware,
    isHistorical,
  };
}
