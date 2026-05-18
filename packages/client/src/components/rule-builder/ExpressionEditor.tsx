// Expression Mode editor — textarea + transparent overlay rendering colored
// tokens. The user types into a regular textarea whose text color is fully
// transparent; an absolutely-positioned `<pre>` mirrors the same content with
// per-token coloring + rainbow bracket nesting. Caret + selection still come
// from the textarea, so editing feels native.
//
// Tokenizing is intentionally tolerant of incomplete input: every keystroke
// is re-tokenized, and a parse failure at the tail renders the offending
// substring underlined in `text-neg`.

import { useMemo, useRef } from 'react';
import { FUNCTION_CATALOG, FIELD_CATALOG } from '@tradl/shared';
import type { CustomColumnDefinition } from '../../core/types';

interface Props {
  value: string;
  onChange: (v: string) => void;
  errorPos?: number | null;
  activeLiteralRange?: { start: number; end: number } | null;
  onLiteralClick?: (range: { start: number; end: number }) => void;
  rows?: number;
  placeholder?: string;
  /** Live custom columns — names matching idents in the source get the
   *  column-ref token color. */
  availableColumns?: readonly CustomColumnDefinition[];
}

// Tokenized form for overlay rendering. Keyed off the parser's tokenizer
// shape (we re-tokenize independently so we don't depend on the AST).

type TokKind =
  | 'fn-math' | 'fn-logic' | 'fn-crossStrike'
  | 'fn-recentHistory' | 'fn-pastDays'
  | 'field-call' | 'field-put' | 'field-market'
  | 'cross-field-call' | 'cross-field-put' | 'cross-field-market'
  | 'column' | 'cross-column'
  | 'num' | 'duration' | 'str' | 'const'
  | 'op-compare' | 'op-logical' | 'op-arith'
  | 'bracket' | 'punct' | 'plain';

const STRIKE_PREFIX = 'strike_';
const LEGACY_CROSS_PREFIX = 'cross_';

interface Tok {
  kind: TokKind;
  text: string;
  start: number;
  end: number;
  /** For brackets only: depth (0,1,2 cycling). */
  depth?: number;
}

type FnSpecBrief = { category: string };
type FieldSpecBrief = { group: 'callSide' | 'putSide' | 'market' };
const FN_BY_NAME = new Map<string, FnSpecBrief>(
  FUNCTION_CATALOG.map((f) => [f.technicalName, { category: f.category }]),
);
const FIELD_BY_NAME = new Map<string, FieldSpecBrief>(
  FIELD_CATALOG.map((f) => [f.technicalName, { group: f.group }]),
);

const FN_CATEGORY_CLASS: Record<string, TokKind> = {
  math: 'fn-math',
  logic: 'fn-logic',
  crossStrike: 'fn-crossStrike',
  recentHistory: 'fn-recentHistory',
  pastDays: 'fn-pastDays',
  data: 'fn-math', // shouldn't happen — Data category has fields not functions
};

const FIELD_GROUP_CLASS: Record<string, TokKind> = {
  callSide: 'field-call',
  putSide: 'field-put',
  market: 'field-market',
};

/** Tokenize for display only. Tolerant — never throws. Stops on the first
 *  unrecognizable character and returns a trailing 'plain' span for the rest.
 *  `columnNames` is a set of saved column names that get the column-ref
 *  token color (otherwise they'd fall back to `plain`). */
function tokenize(src: string, columnNames: ReadonlySet<string>): Tok[] {
  const out: Tok[] = [];
  const depthStack: number[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // whitespace
    if (/\s/.test(c)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      out.push({ kind: 'plain', text: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    // number — and possible duration suffix
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const numEnd = j;
      // Peek for unit suffix to fold into a duration.
      if (j < src.length && /[a-zA-Z]/.test(src[j])) {
        let k = j;
        while (k < src.length && /[a-zA-Z]/.test(src[k])) k++;
        out.push({ kind: 'duration', text: src.slice(i, k), start: i, end: k });
        i = k;
        continue;
      }
      out.push({ kind: 'num', text: src.slice(i, numEnd), start: i, end: numEnd });
      i = numEnd;
      continue;
    }
    // identifier
    if (c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const name = src.slice(i, j);
      // Lookahead for `(` to decide function vs field/const.
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      const isCall = src[k] === '(';
      let kind: TokKind = 'plain';
      if (isCall) {
        const spec = FN_BY_NAME.get(name);
        kind = spec ? FN_CATEGORY_CLASS[spec.category] ?? 'fn-math' : 'plain';
      } else if (name === 'PI' || name === 'E') {
        kind = 'const';
      } else if (name.startsWith(STRIKE_PREFIX) || name.startsWith(LEGACY_CROSS_PREFIX)) {
        // Strip the iterated-strike prefix (canonical `strike_` or legacy
        // `cross_`) and look up the underlying field's group. The cross-tinted
        // variant uses italic + slight muting in CSS to mark "this reads from
        // another strike."
        const prefixLen = name.startsWith(STRIKE_PREFIX)
          ? STRIKE_PREFIX.length : LEGACY_CROSS_PREFIX.length;
        const baseName = name.slice(prefixLen);
        const base = FIELD_BY_NAME.get(baseName);
        if (base) {
          kind = `cross-${FIELD_GROUP_CLASS[base.group]}` as TokKind;
        } else if (columnNames.has(baseName)) {
          kind = 'cross-column';
        } else {
          kind = 'plain';
        }
      } else {
        const field = FIELD_BY_NAME.get(name);
        if (field) {
          kind = FIELD_GROUP_CLASS[field.group];
        } else if (columnNames.has(name)) {
          kind = 'column';
        } else {
          kind = 'plain';
        }
      }
      out.push({ kind, text: name, start: i, end: j });
      i = j;
      continue;
    }
    // quoted string
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j++;
      const end = j < src.length ? j + 1 : j;
      out.push({ kind: 'str', text: src.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    // brackets
    if (c === '(') {
      const depth = depthStack.length % 3;
      depthStack.push(depth);
      out.push({ kind: 'bracket', text: c, start: i, end: i + 1, depth });
      i++;
      continue;
    }
    if (c === ')') {
      const depth = depthStack.length > 0 ? depthStack.pop()! : 0;
      out.push({ kind: 'bracket', text: c, start: i, end: i + 1, depth });
      i++;
      continue;
    }
    // multi-char operators
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
      out.push({ kind: 'op-compare', text: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (two === '&&' || two === '||') {
      out.push({ kind: 'op-logical', text: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // single-char operators
    if (c === '>' || c === '<') {
      out.push({ kind: 'op-compare', text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === '!') {
      out.push({ kind: 'op-logical', text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%') {
      out.push({ kind: 'op-arith', text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === ',' || c === '?' || c === ':') {
      out.push({ kind: 'punct', text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    // unknown — render as plain (no crash).
    out.push({ kind: 'plain', text: c, start: i, end: i + 1 });
    i++;
  }
  return out;
}

export function ExpressionEditor({
  value, onChange, errorPos, activeLiteralRange, onLiteralClick,
  rows = 3, placeholder, availableColumns,
}: Props) {
  const columnNames = useMemo(
    () => new Set((availableColumns ?? []).map((c) => c.name)),
    [availableColumns],
  );
  const tokens = useMemo(() => tokenize(value, columnNames), [value, columnNames]);
  const overlayRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep overlay scroll in sync with textarea scroll.
  const handleScroll = () => {
    if (!overlayRef.current || !taRef.current) return;
    overlayRef.current.scrollTop = taRef.current.scrollTop;
    overlayRef.current.scrollLeft = taRef.current.scrollLeft;
  };

  return (
    <div className="expr-editor">
      <pre ref={overlayRef} className="expr-editor-overlay" aria-hidden="true">
        {tokens.map((t, i) => renderTok(t, i, activeLiteralRange, onLiteralClick, errorPos))}
        {/* Newline at end so the box grows correctly when value ends with \n */}
        {'\n'}
      </pre>
      <textarea
        ref={taRef}
        className="expr-editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        spellCheck={false}
        rows={rows}
        placeholder={placeholder}
      />
    </div>
  );
}

function renderTok(
  t: Tok,
  i: number,
  active: { start: number; end: number } | null | undefined,
  onLiteralClick: ((r: { start: number; end: number }) => void) | undefined,
  errorPos: number | null | undefined,
): JSX.Element {
  if (t.kind === 'plain') {
    // Plain text might include the error position — split there.
    if (errorPos != null && errorPos >= t.start && errorPos < t.end) {
      const before = t.text.slice(0, errorPos - t.start);
      const errChar = t.text[errorPos - t.start];
      const after = t.text.slice(errorPos - t.start + 1);
      return (
        <span key={i}>
          {before}
          <span className="expr-error-char">{errChar}</span>
          {after}
        </span>
      );
    }
    return <span key={i}>{t.text}</span>;
  }
  if (t.kind === 'num') {
    const isActive = active && active.start === t.start && active.end === t.end;
    const cls = `expr-tok-num${isActive ? ' expr-tok-num-active' : ''}${onLiteralClick ? ' expr-tok-clickable' : ''}`;
    return (
      <span
        key={i}
        className={cls}
        onMouseDown={onLiteralClick ? (e) => {
          // Don't steal focus from the textarea — just bind the slider.
          e.preventDefault();
          onLiteralClick({ start: t.start, end: t.end });
        } : undefined}
      >
        {t.text}
      </span>
    );
  }
  if (t.kind === 'bracket') {
    return <span key={i} className={`expr-tok-bracket expr-bracket-${t.depth ?? 0}`}>{t.text}</span>;
  }
  return <span key={i} className={`expr-tok-${t.kind}`}>{t.text}</span>;
}

// Heuristic util — given an AST-derived offset, find the duration of the
// underlying token in the source. Used by the slider when it needs to
// rewrite at exactly the literal's char span without re-parsing every drag.
export function literalRangeAt(src: string, start: number): { start: number; end: number } | null {
  // Tokenize without a column-names set — we're only looking at numeric
  // literal positions, which aren't affected by ident coloring.
  const toks = tokenize(src, new Set());
  // First, try to match a unary-minus + num pair.
  const idx = toks.findIndex((t) => t.start === start);
  if (idx < 0) return null;
  const t = toks[idx];
  // unary-minus is rendered as op-arith '-'. Pair with next num if adjacent.
  if (t.kind === 'op-arith' && t.text === '-') {
    const next = toks[idx + 1];
    if (next && next.kind === 'num' && next.start === t.end) {
      return { start: t.start, end: next.end };
    }
  }
  if (t.kind === 'num') return { start: t.start, end: t.end };
  return null;
}
