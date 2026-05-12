// Typed fetch wrapper for /api/ai/parse — server returns AI-parsed rule or column.

import type {
  Condition, ConditionLhs, ConditionRhs, CustomColumnDefinition,
  NumericField, Operator, RuleDefinition,
} from '../core/types';

interface RawRule {
  name: string;
  description: string;
  logic: 'AND' | 'OR';
  scope: 'call' | 'put' | 'row';
  conditions: {
    lhs: { kind: 'field' | 'expr'; field?: string; expression?: string };
    operator: Operator;
    rhs: { kind: 'literal' | 'field' | 'expr'; value?: number; field?: string; expression?: string };
  }[];
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
  // Server returned this after a successful self-repair retry. Lets the
  // palette show a subtle "corrected by AI" hint.
  repaired?: boolean;
}

export class AIParseError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    // Validator's longer explanation (422 only).
    public readonly detail?: string,
    // The original LLM draft that failed validation (422 only). Lets the
    // palette drop into the JSON editor so the user can hand-fix.
    public readonly draft?: AIParseResult,
  ) {
    super(message);
  }
}

// One previous turn of the refine conversation. The client sends an array of
// these so the server can replay the chat statelessly. `assistantJson` is the
// stringified prior AIParseResult (matches what the LLM emitted).
export interface AITurn {
  userText: string;
  assistantJson: string;
}

export interface AIParseRequest {
  input: string;
  availableFields: string[];
  existingRules: string[];
  existingColumns: string[];
  // Identifies which symbol the server should pick its ATM sample row from
  // for the dry-run validation.
  symbol?: string;
  // Prior turns of the refine conversation (oldest → newest). Capped server-
  // side to bound payload.
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

// ─── Adapters: AI shape → app shape ───
//
// The AI emits the same lhs/operator/rhs structure the engine consumes, so the
// adapters mostly fix up missing optional fields and assign a fresh id + hue.

export function ruleFromAi(raw: RawRule, hue: number): RuleDefinition {
  return {
    id: `ai_${Date.now().toString(36)}`,
    name: raw.name,
    description: raw.description,
    enabled: true,
    logic: raw.logic,
    style: { hue, scope: raw.scope },
    conditions: raw.conditions.map((c): Condition => ({
      lhs: normalizeLhs(c.lhs),
      operator: c.operator,
      rhs: normalizeRhs(c.rhs),
    })),
    slider: deriveSlider(raw),
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

function normalizeLhs(lhs: RawRule['conditions'][number]['lhs']): ConditionLhs {
  if (lhs.kind === 'field' && lhs.field) {
    return { kind: 'field', field: lhs.field as NumericField };
  }
  return { kind: 'expr', expression: lhs.expression ?? '' };
}

function normalizeRhs(rhs: RawRule['conditions'][number]['rhs']): ConditionRhs {
  if (rhs.kind === 'literal' && typeof rhs.value === 'number') {
    return { kind: 'literal', value: rhs.value };
  }
  if (rhs.kind === 'field' && rhs.field) {
    return { kind: 'field', field: rhs.field as NumericField };
  }
  return { kind: 'expr', expression: rhs.expression ?? '' };
}

// If the first condition has a literal rhs, expose it as a slider so users can
// tune the threshold from the rule editor without re-prompting.
function deriveSlider(raw: RawRule) {
  const c = raw.conditions[0];
  if (!c || c.rhs.kind !== 'literal' || typeof c.rhs.value !== 'number') return undefined;
  const v = c.rhs.value;
  const abs = Math.abs(v);
  const step = abs >= 1000 ? Math.round(abs / 100) : abs >= 10 ? 0.5 : 0.05;
  const min = v < 0 ? Math.min(v * 4, -100_000) : 0;
  const max = v < 0 ? 0 : Math.max(v * 4, 100);
  return {
    conditionIndex: 0,
    min,
    max,
    step,
    label: 'Threshold',
  };
}
