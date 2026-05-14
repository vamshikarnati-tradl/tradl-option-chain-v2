import type { CustomColumnDefinition, RuleDefinition, RuleSlider } from './types';
import { PREDEFINED_COLUMNS, PREDEFINED_RULES } from './predefined';
import { hueFromHex, PALETTE_HUES } from './palette';
import { STORAGE_KEYS } from './storage-keys';

const RULES_KEY = STORAGE_KEYS.rules;
const COLUMNS_KEY = STORAGE_KEYS.columns;

const PREDEFINED_BY_ID = new Map(PREDEFINED_RULES.map((r) => [r.id, r]));

// ─────── Rules ───────
//
// Rules migrated from the legacy multi-condition shape to single-expression
// form. The migrator is best-effort: predefined rules with matching IDs are
// replaced with the latest authored shape (keeping enabled state). Custom
// rules are translated by stringifying each condition and joining with `&&`
// or `||` per the rule's logic.

interface LegacyConditionSide {
  kind?: 'field' | 'literal' | 'expr' | 'range';
  field?: string;
  value?: number | [number, number];
  expression?: string;
}

interface LegacyCondition {
  lhs?: LegacyConditionSide;
  operator?: string;
  rhs?: LegacyConditionSide;
}

interface LegacyRule {
  id?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  // Modern fields
  expression?: string;
  hue?: number;
  slider?: Partial<RuleSlider> & { conditionIndex?: number };
  // Legacy fields
  logic?: 'AND' | 'OR';
  conditions?: LegacyCondition[];
  style?: { hue?: number; color?: string; backgroundColor?: string; scope?: string };
}

const OP_TO_SYM: Record<string, string> = {
  gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '==', neq: '!=',
};

function sideToString(side: LegacyConditionSide | undefined): string {
  if (!side) return '';
  if (side.kind === 'field' && side.field) return side.field;
  if (side.kind === 'literal' && typeof side.value === 'number') return String(side.value);
  if (side.kind === 'expr' && side.expression) return side.expression;
  return '';
}

function legacyConditionToExpr(cond: LegacyCondition): string {
  const lhs = sideToString(cond.lhs);
  const op = cond.operator ?? '';
  const rhs = cond.rhs;
  if (!rhs || !lhs) return '';
  if (op === 'between' && rhs.kind === 'range' && Array.isArray(rhs.value)) {
    const [lo, hi] = rhs.value;
    return `(${lhs} >= ${lo} && ${lhs} <= ${hi})`;
  }
  const opSym = OP_TO_SYM[op];
  if (!opSym) return '';
  const rhsStr = rhs.kind === 'literal' && typeof rhs.value === 'number'
    ? String(rhs.value)
    : rhs.kind === 'field' && rhs.field
      ? rhs.field
      : rhs.kind === 'expr' && rhs.expression
        ? rhs.expression
        : '';
  if (!rhsStr) return '';
  return `${lhs} ${opSym} ${rhsStr}`;
}

function buildLegacyExpression(rule: LegacyRule): string {
  const conds = rule.conditions ?? [];
  const parts = conds.map(legacyConditionToExpr).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const joiner = rule.logic === 'OR' ? ' || ' : ' && ';
  // Wrap each operand in parens to make precedence explicit when joining
  // multiple conditions — `a > b && c > d || e > f` would otherwise read
  // differently than the legacy AND/OR shape intended.
  return parts.map((p) => `(${p})`).join(joiner);
}

function resolveHue(raw: LegacyRule, idx: number): number {
  if (typeof raw.hue === 'number') return raw.hue;
  const style = raw.style ?? {};
  if (typeof style.hue === 'number') return style.hue;
  if (typeof style.color === 'string') return hueFromHex(style.color);
  if (typeof style.backgroundColor === 'string') {
    const m = style.backgroundColor.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const hex = `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`;
      return hueFromHex(hex);
    }
  }
  return PALETTE_HUES[idx % PALETTE_HUES.length].hue;
}

function migrateLegacySlider(
  rawSlider: LegacyRule['slider'],
  rule: LegacyRule,
  expression: string,
): RuleSlider | undefined {
  if (!rawSlider) return undefined;
  const conditionIndex = rawSlider.conditionIndex ?? 0;
  const cond = rule.conditions?.[conditionIndex];
  // Best-effort search for the rhs literal in the migrated expression.
  if (cond?.rhs?.kind === 'literal' && typeof cond.rhs.value === 'number') {
    const needle = String(cond.rhs.value);
    const idx = expression.indexOf(needle);
    if (idx >= 0) {
      // If the literal is negative the legacy shape stored the negation in
      // the value itself ("-5000"). Migration prepends a unary minus; for
      // that case the offset already points at the `-`.
      return {
        literalOffset: idx,
        min: rawSlider.min ?? 0,
        max: rawSlider.max ?? 100,
        step: rawSlider.step ?? 1,
        label: rawSlider.label,
      };
    }
  }
  return undefined;
}

function migrateRule(raw: LegacyRule, idx: number): RuleDefinition | null {
  // If the raw is already in the new shape, use it.
  if (typeof raw.expression === 'string' && raw.expression.trim()) {
    const predefined = raw.id ? PREDEFINED_BY_ID.get(raw.id) : undefined;
    // For predefined ids, reseed everything except `enabled` — keeps users
    // current as we ship new defaults.
    if (predefined) {
      return { ...predefined, enabled: raw.enabled !== false };
    }
    return {
      id: raw.id ?? `rule_${Date.now().toString(36)}_${idx}`,
      name: raw.name ?? 'Unnamed',
      description: raw.description,
      enabled: raw.enabled !== false,
      expression: raw.expression,
      hue: typeof raw.hue === 'number' ? raw.hue : resolveHue(raw, idx),
      slider: isFullSlider(raw.slider) ? raw.slider : undefined,
    };
  }

  // Legacy multi-condition path. Predefined IDs win again — they get the
  // latest authored shape so the migration table doesn't need to recompute
  // offsets for built-ins.
  const predefined = raw.id ? PREDEFINED_BY_ID.get(raw.id) : undefined;
  if (predefined) {
    return { ...predefined, enabled: raw.enabled !== false };
  }

  const expression = buildLegacyExpression(raw);
  if (!expression) return null;
  return {
    id: raw.id ?? `rule_${Date.now().toString(36)}_${idx}`,
    name: raw.name ?? 'Unnamed',
    description: raw.description,
    enabled: raw.enabled !== false,
    expression,
    hue: resolveHue(raw, idx),
    slider: migrateLegacySlider(raw.slider, raw, expression),
  };
}

function isFullSlider(s: LegacyRule['slider']): s is RuleSlider {
  return !!s
    && typeof s.literalOffset === 'number'
    && typeof s.min === 'number'
    && typeof s.max === 'number'
    && typeof s.step === 'number';
}

export function loadRules(): RuleDefinition[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return PREDEFINED_RULES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return PREDEFINED_RULES;
    const migrated: RuleDefinition[] = [];
    parsed.forEach((entry, i) => {
      const m = migrateRule(entry as LegacyRule, i);
      if (m) migrated.push(m);
    });
    return migrated.length > 0 ? migrated : PREDEFINED_RULES;
  } catch {
    return PREDEFINED_RULES;
  }
}

export function saveRules(rules: RuleDefinition[]): void {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    // quota exceeded — silently ignore
  }
}

// ─────── Columns ───────
//
// v1 shape: `[{...column}, ...]`.
// v2 shape: `{ version: 2, columns: [...] }`. Column entries gained an
// optional `displayLabel`, and `name` is now a validated identifier (no
// spaces or special chars). v1 → v2 migration: invalid names get slugged;
// the original name is kept as `displayLabel`.

import { isValidColumnName, slugifyToIdentifier } from './column-name';
import { rewriteIdent } from './expression-rewrite';

interface ColumnsEnvelopeV2 {
  version: 2;
  columns: CustomColumnDefinition[];
}

function isEnvelopeV2(x: unknown): x is ColumnsEnvelopeV2 {
  return !!x && typeof x === 'object' && (x as { version?: unknown }).version === 2
    && Array.isArray((x as { columns?: unknown }).columns);
}

interface MigratedColumns {
  columns: CustomColumnDefinition[];
  /** Map of old-name → new-name for renames forced by the migrator. Applied
   *  to dependent rule + column expressions below. */
  renames: Array<{ oldName: string; newName: string }>;
}

function migrateColumnsToV2(raw: unknown[]): MigratedColumns {
  const renames: Array<{ oldName: string; newName: string }> = [];
  const seenNames = new Set<string>();
  const out: CustomColumnDefinition[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<CustomColumnDefinition>;
    if (typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.expression !== 'string') continue;
    let nextName = e.name;
    let displayLabel = e.displayLabel;
    if (!isValidColumnName(nextName) || seenNames.has(nextName)) {
      const slug = slugifyToIdentifier(nextName);
      // Resolve collisions with a numeric suffix.
      let candidate = slug;
      let n = 2;
      while (seenNames.has(candidate)) candidate = `${slug}${n++}`;
      if (candidate !== nextName) {
        renames.push({ oldName: nextName, newName: candidate });
        displayLabel = displayLabel ?? e.name; // preserve original as label
        nextName = candidate;
      }
    }
    seenNames.add(nextName);
    out.push({
      id: e.id,
      name: nextName,
      displayLabel,
      description: e.description,
      expression: e.expression,
      format: e.format ?? { type: 'number', decimals: 2 },
      side: e.side ?? 'general',
    });
  }
  return { columns: out, renames };
}

/** Apply the rewrites returned by `migrateColumnsToV2` to dependent rule
 *  + column expressions stored in localStorage. Run after a load that
 *  produced renames, so references stay valid. */
function applyMigrationRewrites(
  columns: CustomColumnDefinition[],
  renames: Array<{ oldName: string; newName: string }>,
): CustomColumnDefinition[] {
  let rewritten = columns;
  for (const { oldName, newName } of renames) {
    rewritten = rewritten.map((c) => ({
      ...c,
      expression: rewriteIdent(c.expression, oldName, newName).source,
    }));
  }
  // Migrate dependent rules too (in localStorage).
  try {
    const rawRules = localStorage.getItem(RULES_KEY);
    if (rawRules) {
      const rules = JSON.parse(rawRules);
      if (Array.isArray(rules)) {
        let mutated = false;
        const next = rules.map((r: { expression?: string }) => {
          if (typeof r?.expression !== 'string') return r;
          let nextExpr = r.expression;
          for (const { oldName, newName } of renames) {
            const rw = rewriteIdent(nextExpr, oldName, newName);
            if (rw.source !== nextExpr) { nextExpr = rw.source; mutated = true; }
          }
          return nextExpr === r.expression ? r : { ...r, expression: nextExpr };
        });
        if (mutated) localStorage.setItem(RULES_KEY, JSON.stringify(next));
      }
    }
  } catch { /* ignore */ }
  return rewritten;
}

export function loadColumns(): CustomColumnDefinition[] {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY);
    if (!raw) return PREDEFINED_COLUMNS;
    const parsed = JSON.parse(raw);

    // Both v1 (bare array) and v2 (envelope) get the same name-validator
    // treatment. Columns saved in v2 form before the validator existed could
    // still have spaces or special chars in their names — re-run the
    // migrator on every load so those get slugged and dependent expressions
    // get rewritten.
    let rawColumns: unknown[] | null = null;
    if (isEnvelopeV2(parsed)) {
      rawColumns = parsed.columns;
    } else if (Array.isArray(parsed)) {
      rawColumns = parsed;
    }
    if (!rawColumns) return PREDEFINED_COLUMNS;

    const { columns, renames } = migrateColumnsToV2(rawColumns);
    if (columns.length === 0) return PREDEFINED_COLUMNS;

    if (renames.length > 0) {
      const rewritten = applyMigrationRewrites(columns, renames);
      // Persist back in v2 shape so the migration runs once per change.
      try {
        const envelope: ColumnsEnvelopeV2 = { version: 2, columns: rewritten };
        localStorage.setItem(COLUMNS_KEY, JSON.stringify(envelope));
      } catch { /* ignore */ }
      return rewritten;
    }
    // No renames — persist envelope shape anyway so future loads skip migration.
    try {
      const envelope: ColumnsEnvelopeV2 = { version: 2, columns };
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(envelope));
    } catch { /* ignore */ }
    return columns;
  } catch {
    return PREDEFINED_COLUMNS;
  }
}

export function saveColumns(columns: CustomColumnDefinition[]): void {
  try {
    const envelope: ColumnsEnvelopeV2 = { version: 2, columns };
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(envelope));
  } catch {
    // ignore
  }
}

export function resetAll(): void {
  localStorage.removeItem(RULES_KEY);
  localStorage.removeItem(COLUMNS_KEY);
}
