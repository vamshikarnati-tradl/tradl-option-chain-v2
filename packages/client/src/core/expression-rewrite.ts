// Tokenizer-aware identifier find/replace + slider-offset reflow.
//
// We can't use a regex like /\bmaxPain\b/ to rename column references because
// the source string may contain other identifiers that happen to share a
// substring, or quoted strings whose contents look like identifiers. The
// safest approach: tokenize the source with the same lexer the parser uses,
// then rebuild the source by emitting tokens unchanged except for `ident`
// tokens whose value equals the rename target.
//
// We don't have the parser's Tokenizer exported, so we duplicate the minimal
// logic here. The duplication is intentional: this rewriter does not need
// to handle parse-time errors (it only walks lexical tokens, never builds
// an AST), and pulling Tokenizer into shared would expose internals that
// nothing else needs.

interface RewriteToken {
  start: number;
  end: number;
  /** When defined, this is an `ident` whose text we may rewrite. */
  ident?: string;
}

function tokenizeFlat(src: string): RewriteToken[] {
  const out: RewriteToken[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      out.push({ start: i, end: j });
      i = j;
      continue;
    }
    // Numbers (and possible duration suffixes — we keep them whole)
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      out.push({ start: i, end: j });
      i = j;
      continue;
    }
    // Identifiers — rewrite candidate.
    if (c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const name = src.slice(i, j);
      out.push({ start: i, end: j, ident: name });
      i = j;
      continue;
    }
    // Quoted strings — never rewrite contents.
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j++;
      const end = j < src.length ? j + 1 : j;
      out.push({ start: i, end });
      i = end;
      continue;
    }
    // Multi-char operators (just consume; never an ident)
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
      out.push({ start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // Any other single char
    out.push({ start: i, end: i + 1 });
    i++;
  }
  return out;
}

/**
 * Replace every occurrence of identifier `from` with `to` in the source.
 * Preserves whitespace, operators, string literals, and any identifier whose
 * text doesn't equal `from`. Returns the rewritten string and a mapping of
 * old→new char offsets so callers can reflow other indices (e.g. a slider's
 * `literalOffset`).
 */
export interface RewriteResult {
  source: string;
  /** Map of old-char-offset → new-char-offset. Only includes positions
   *  immediately after each token boundary; callers reflow other indices by
   *  finding the largest entry ≤ their old offset and adding the delta. */
  offsets: Array<{ oldStart: number; newStart: number }>;
}

export function rewriteIdent(source: string, from: string, to: string): RewriteResult {
  if (from === to) {
    return { source, offsets: [{ oldStart: 0, newStart: 0 }] };
  }
  const tokens = tokenizeFlat(source);
  let out = '';
  const offsets: Array<{ oldStart: number; newStart: number }> = [];
  for (const tok of tokens) {
    offsets.push({ oldStart: tok.start, newStart: out.length });
    if (tok.ident === from) {
      out += to;
    } else {
      out += source.slice(tok.start, tok.end);
    }
  }
  // Sentinel for the very end of the string so reflow lookups can clamp.
  offsets.push({ oldStart: source.length, newStart: out.length });
  return { source: out, offsets };
}

/** Map of legacy function names → their canonical replacements introduced
 *  by the chain-vs-pivot refactor. Applied lazily on load by `migrateExpression`. */
const LEGACY_FUNCTION_RENAMES: Record<string, string> = {
  sumStrikes: 'chainSum',
  avgStrikes: 'chainAvg',
  medianStrikes: 'chainMedian',
  minStrikes: 'chainMin',
  maxStrikes: 'chainMax',
  stddevStrikes: 'chainStddev',
  sumOverStrikes: 'pivotSum',
  avgOverStrikes: 'pivotAvg',
  productOverStrikes: 'pivotProduct',
  maxOverStrikes: 'pivotMax',
  minOverStrikes: 'pivotMin',
  medianOverStrikes: 'pivotMedian',
  countOverStrikes: 'pivotCount',
};

/** One-shot migration applied to every saved expression on load:
 *    - `cross_*` field/column refs → `strike_*`
 *    - `*Strikes` family → `chain*`
 *    - `*OverStrikes` family → `pivot*`
 *  Semantics are preserved across the rename (both sides bind plain field
 *  names to the same row they used to).
 *
 *  Returns the rewritten source plus the offset table — callers reflow
 *  slider literal offsets through the table. The empty-result optimisation
 *  short-circuits when nothing changed. */
export function migrateExpression(source: string): RewriteResult {
  const tokens = tokenizeFlat(source);
  let out = '';
  const offsets: Array<{ oldStart: number; newStart: number }> = [];
  let mutated = false;
  for (const tok of tokens) {
    offsets.push({ oldStart: tok.start, newStart: out.length });
    if (tok.ident !== undefined) {
      const legacyFn = LEGACY_FUNCTION_RENAMES[tok.ident];
      if (legacyFn) {
        out += legacyFn;
        mutated = true;
        continue;
      }
      if (tok.ident.startsWith('cross_')) {
        out += 'strike_' + tok.ident.slice('cross_'.length);
        mutated = true;
        continue;
      }
    }
    out += source.slice(tok.start, tok.end);
  }
  offsets.push({ oldStart: source.length, newStart: out.length });
  return mutated
    ? { source: out, offsets }
    : { source, offsets: [{ oldStart: 0, newStart: 0 }] };
}

/**
 * Translate a char offset from the pre-rewrite source to the post-rewrite
 * source. Uses the offset table from `rewriteIdent`. If the old offset
 * lands inside a renamed token, the result lands at the start of the
 * replacement token. If the old position lands in unchanged text, the
 * result preserves the relative offset.
 */
export function reflowOffset(
  oldOffset: number, offsets: ReadonlyArray<{ oldStart: number; newStart: number }>,
): number {
  if (offsets.length === 0) return oldOffset;
  // Binary search would be cleaner; linear is fine for short expressions.
  let prev = offsets[0];
  for (const entry of offsets) {
    if (entry.oldStart > oldOffset) break;
    prev = entry;
  }
  const delta = oldOffset - prev.oldStart;
  return prev.newStart + delta;
}
