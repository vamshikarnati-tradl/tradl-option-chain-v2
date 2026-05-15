// Client for /api/ai/parse — tool-use loop variant.
//
// Wire format:
//   request:  { input, index, columns, existingRules?, symbol?, state? }
//   response: { kind: 'result', result } | { kind: 'clarification', question, state }
//
// `state` is opaque to the client — when the server returns a clarification,
// the client renders the question as an assistant turn, lets the user type
// an answer, and posts the answer back with the same `state` echoed in the
// request. The server replays the prior conversation and resumes its loop.

import type {
  CustomColumnDefinition, RuleDefinition,
} from '../core/types';
import type { LlmIndex } from '../core/llm-index';

export interface ParsedRulePayload {
  name: string;
  description: string;
  expression: string;
}

export interface ParsedColumnPayload {
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
  rule?: ParsedRulePayload;
  column?: ParsedColumnPayload;
  options?: AmbiguousOption[];
}

/** Opaque conversation blob — the client never inspects it. */
export type ConversationState = unknown;

export type AIParseResponse =
  | { kind: 'result'; result: AIParseResult }
  | { kind: 'clarification'; question: string; state: ConversationState };

export interface AIParseRequest {
  input: string;
  index: LlmIndex;
  /** Saved columns the server needs for column-aware validation. The LLM
   *  only sees what's encoded into `index.columns` — column expressions are
   *  validation-only. */
  columns: Array<{ id: string; name: string; expression: string }>;
  existingRules?: string[];
  symbol?: string;
  state?: ConversationState;
}

export class AIParseError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export async function parseNaturalLanguage(
  req: AIParseRequest, signal?: AbortSignal,
): Promise<AIParseResponse> {
  const res = await fetch('/api/ai/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new AIParseError(body.error ?? `Parse failed (${res.status})`, res.status, body.detail);
  }
  return (await res.json()) as AIParseResponse;
}

// ─── Adapters: AI payload → engine shapes ───

export function ruleFromAi(raw: ParsedRulePayload, hue: number): RuleDefinition {
  return {
    id: `ai_${Date.now().toString(36)}`,
    name: raw.name,
    description: raw.description,
    enabled: true,
    expression: raw.expression,
    hue,
    // Slider derivation is best-effort — the legacy heuristic snapped to
    // the first comparison RHS literal. With single expressions we'd need
    // a tokenizer walk to find a representative literal; defer that for now
    // (users can bind via click-a-literal in the Rule Builder).
  };
}

export function columnFromAi(raw: ParsedColumnPayload): CustomColumnDefinition {
  return {
    id: `ai_col_${Date.now().toString(36)}`,
    name: raw.name,
    expression: raw.expression,
    format: raw.format,
    side: 'general',
  };
}
