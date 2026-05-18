// Validation + slugging for custom-column (and value) identifier names.
//
// A column's `name` doubles as its identifier inside expressions
// (`maxPain > 100`). It must therefore be a syntactically-valid identifier
// that doesn't collide with any reserved name in the parser's vocabulary:
// fields, functions, constants, or the `strike_` / `cross_` (legacy alias)
// / `col_` prefixes used for other AST machinery.

import { NUMERIC_FIELDS, knownFunctionNames } from '@tradl/shared';

/** Pattern for a valid expression identifier. Same rules as a JS identifier
 *  minus the unicode bits: ASCII letters / underscore start, ASCII alnum +
 *  underscore tail. */
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Names a user column may not adopt. Composed at module-load time from the
 *  parser's known sets so future additions to the catalog or NUMERIC_FIELDS
 *  automatically extend the block-list. */
const RESERVED_LITERAL_WORDS = new Set([
  'PI', 'E',
  'true', 'false', 'null', 'undefined',
  'tick', 's', 'm', 'h', 'd',  // duration unit shorthand
]);

const FORBIDDEN_PREFIXES = ['strike_', 'cross_', 'col_'];

export function reservedNames(): Set<string> {
  return new Set<string>([
    ...NUMERIC_FIELDS,
    ...knownFunctionNames(),
    ...RESERVED_LITERAL_WORDS,
  ]);
}

export function isValidColumnName(name: string): boolean {
  return IDENT_RE.test(name);
}

export interface NameValidationOk {
  ok: true;
}

export interface NameValidationFail {
  ok: false;
  reason: string;
  /** A slug derived from the user's input that would pass validation. */
  suggestion?: string;
}

export type NameValidationResult = NameValidationOk | NameValidationFail;

/**
 * Validate a proposed column name against the parser's reserved vocabulary
 * and the names of other columns. The optional `selfId` excludes the column
 * currently being edited from the uniqueness check (so re-saving with the
 * same name doesn't trip the dupe check).
 */
export function validateColumnName(
  name: string,
  others: { id: string; name: string }[] = [],
  selfId?: string,
): NameValidationResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Name cannot be empty.' };
  }
  if (!IDENT_RE.test(trimmed)) {
    return {
      ok: false,
      reason: 'Must start with a letter or underscore and contain only letters, digits, and underscores. No spaces.',
      suggestion: slugifyToIdentifier(trimmed),
    };
  }
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return {
        ok: false,
        reason: `"${prefix}" is a reserved prefix.`,
        suggestion: trimmed.replace(new RegExp(`^${prefix}`), ''),
      };
    }
  }
  if (reservedNames().has(trimmed)) {
    return {
      ok: false,
      reason: `"${trimmed}" is a reserved name (field, function, or constant).`,
      suggestion: `${trimmed}Col`,
    };
  }
  // Case-insensitive uniqueness across other columns.
  const lower = trimmed.toLowerCase();
  for (const o of others) {
    if (o.id === selfId) continue;
    if (o.name.toLowerCase() === lower) {
      return {
        ok: false,
        reason: `Another column already uses the name "${o.name}".`,
        suggestion: `${trimmed}2`,
      };
    }
  }
  return { ok: true };
}

/**
 * Convert any free-form input into a valid identifier. Strips invalid chars,
 * camelCases word boundaries, and ensures the result starts with a letter.
 *
 *   'Max Pain Level'  → 'maxPainLevel'
 *   '24h-PCR'         → 'h24PCR'      (leading digits get an `h` cap)
 *   '%change-of-iv'   → 'changeOfIv'
 */
export function slugifyToIdentifier(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  if (!cleaned) return 'col';
  const parts = cleaned.split(/\s+/);
  const first = parts[0].toLowerCase();
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  let slug = first + rest.join('');
  // Identifiers can't start with a digit. Prefix with `n` if needed.
  if (/^[0-9]/.test(slug)) slug = `n${slug}`;
  return slug;
}
