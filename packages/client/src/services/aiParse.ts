// Typed fetch wrapper for /api/ai/parse — server returns AI-parsed rule or
// column. The server still emits the legacy multi-condition rule shape; this
// adapter collapses it into the new single-expression `RuleDefinition`.

import type {
  CustomColumnDefinition, RuleDefinition,
} from '../core/types';

interface RawConditionSide {
  kind: 'field' | 'expr' | 'literal' | 'range';
  field?: string;
  expression?: string;
  value?: number | [number, number];
}

interface RawCondition {
  lhs: RawConditionSide;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'between';
  rhs: RawConditionSide;
}

interface RawRule {
  name: string;
  description: string;
  logic: 'AND' | 'OR';
  scope: 'call' | 'put' | 'row';
  conditions: RawCondition[];
}

interface RawColumn {
  name: string;
  expression: string;
  format: { type: 'number' | 'percentage' | 'currency'; decimals: number };
}

export interface AmbiguousOption {
  label: string;
  intent: 'rule' | 'column';
  description: string;
}

export interface AIParseResult {
  intent: 'rule' | 'column' | 'ambiguous';
  humanReadable: string;
  confidence: number;
  rule?: RawRule;
  column?: RawColumn;
  options?: AmbiguousOption[];
  repaired?: boolean;
}

export class AIParseError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly detail?: string,
    public readonly draft?: AIParseResult,
  ) {
    super(message);
  }
}

export interface AITurn {
  userText: string;
  assistantJson: string;
}

export interface AIParseRequest {
  input: string;
  availableFields: string[];
  existingRules: string[];
  existingColumns: string[];
  symbol?: string;
  history?: AITurn[];
}

export async function parseNaturalLanguage(req: AIParseRequest, signal?: AbortSignal): Promise<AIParseResult> {
  const res = await fetch('/api/ai/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new AIParseError(
      body.error ?? `Parse failed (${res.status})`,
      res.status,
      body.detail,
      body.draft,
    );
  }
  return (await res.json()) as AIParseResult;
}

// ─── Adapters: AI legacy shape → new single-expression shape ───

const OP_SYM: Record<RawCondition['operator'], string> = {
  gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '==', neq: '!=', between: 'between',
};

function sideToString(side: RawConditionSide): string {
  if (side.kind === 'field' && side.field) return side.field;
  if (side.kind === 'literal' && typeof side.value === 'number') return String(side.value);
  if (side.kind === 'expr' && side.expression) return side.expression;
  return '';
}

function conditionToExpr(c: RawCondition): string {
  const lhs = sideToString(c.lhs);
  if (!lhs) return '';
  if (c.operator === 'between' && c.rhs.kind === 'range' && Array.isArray(c.rhs.value)) {
    const [lo, hi] = c.rhs.value;
    return `(${lhs} >= ${lo} && ${lhs} <= ${hi})`;
  }
  const rhs = sideToString(c.rhs);
  if (!rhs) return '';
  return `${lhs} ${OP_SYM[c.operator]} ${rhs}`;
}

function buildExpression(raw: RawRule): string {
  const parts = raw.conditions.map(conditionToExpr).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const joiner = raw.logic === 'OR' ? ' || ' : ' && ';
  return parts.map((p) => `(${p})`).join(joiner);
}

/** Locate the bound literal of the first condition's rhs in the built
 *  expression string so the slider knows which char range it controls. */
function firstLiteralOffset(raw: RawRule, expression: string): number | null {
  const first = raw.conditions[0];
  if (!first || first.rhs.kind !== 'literal' || typeof first.rhs.value !== 'number') return null;
  const needle = String(first.rhs.value);
  const idx = expression.indexOf(needle);
  return idx >= 0 ? idx : null;
}

export function ruleFromAi(raw: RawRule, hue: number): RuleDefinition {
  const expression = buildExpression(raw);
  const offset = firstLiteralOffset(raw, expression);
  const literal = raw.conditions[0]?.rhs.kind === 'literal' && typeof raw.conditions[0]?.rhs.value === 'number'
    ? raw.conditions[0].rhs.value
    : null;
  return {
    id: `ai_${Date.now().toString(36)}`,
    name: raw.name,
    description: raw.description,
    enabled: true,
    expression,
    hue,
    slider: offset !== null && literal !== null ? deriveSlider(literal, offset) : undefined,
  };
}

export function columnFromAi(raw: RawColumn): CustomColumnDefinition {
  return {
    id: `ai_col_${Date.now().toString(36)}`,
    name: raw.name,
    expression: raw.expression,
    format: raw.format,
    side: 'general',
  };
}

function deriveSlider(literal: number, literalOffset: number) {
  const abs = Math.abs(literal);
  const step = abs >= 1000 ? Math.round(abs / 100) : abs >= 10 ? 0.5 : 0.05;
  const min = literal < 0 ? Math.min(literal * 4, -100_000) : 0;
  const max = literal < 0 ? 0 : Math.max(literal * 4, 100);
  return { literalOffset, min, max, step, label: 'Threshold' };
}
