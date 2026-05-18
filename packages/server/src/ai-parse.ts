// /api/ai/parse — tool-use loop variant.
//
// The client posts:
//   - input: user's natural-language request
//   - index: compact catalog (categories → subgroups → fn names, fields, columns)
//   - columns: raw saved-column defs (used for column-aware validation only)
//   - symbol: ATM sample-row picker for dry-run
//   - state: opaque blob returned on a prior clarification turn; replayed
//            verbatim to resume the loop
//
// The server runs Claude with three tools (defined in prompts/tools.ts):
//   getFunctionDetails  → resolves names against FUNCTION_CATALOG
//   askUserToClarify    → terminates loop, surfaces as a `clarification`
//                         response with the conversation state echoed back
//   submitExpression    → terminates loop; server runs validateBoolean /
//                         validateNumeric against the dry-run sample row.
//                         A failed validation is fed back as a tool_result
//                         so the model can self-repair (no separate retry
//                         pass — the loop handles it naturally).

import Anthropic from '@anthropic-ai/sdk';
import { FUNCTION_CATALOG, type FunctionSpec } from '@tradl/shared';
import { PARSE_SYSTEM_PROMPT } from './prompts/parse.js';
import { PARSE_TOOLS } from './prompts/tools.js';
import {
  validateBooleanExpression, validateNumericExpression, validateValueExpression,
  type ColumnLike, type ValidationResult,
} from './ai-validator.js';
import { getAtmRow } from './snapshot-store.js';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  client = new Anthropic();
  return client;
}

const MAX_TOOL_ITERATIONS = 8;

// ─── Request / response types (mirror the client's expectations) ───

export interface AIParseRequest {
  input: string;
  /** Compact catalog index — `buildLlmIndex(columns)` on the client side. */
  index: unknown;
  /** Raw column defs (name + expression + id) used by the validator to
   *  compile column references in dry-runs. NOT shown to the LLM directly
   *  — the LLM only sees what's in `index`. */
  columns?: ColumnLike[];
  existingRules?: string[];
  symbol?: string;
  /** Returned by the server when the previous call ended in clarification.
   *  The client echoes it back unchanged on the follow-up turn. */
  state?: ConversationState;
}

export interface ConversationState {
  messages: Anthropic.MessageParam[];
}

export type AIParseResponse =
  | { kind: 'result'; result: ParseResult }
  | { kind: 'clarification'; question: string; state: ConversationState };

interface ParsedRule {
  name: string;
  description: string;
  expression: string;
}
interface ParsedColumn {
  name: string;
  expression: string;
  format: { type: 'number' | 'percentage' | 'currency'; decimals: number };
}
interface ParsedValue {
  name: string;
  displayLabel?: string;
  description?: string;
  expression: string;
  format: { type: 'number' | 'percentage' | 'currency'; decimals: number };
}
interface AmbiguousOption {
  label: string;
  intent: 'rule' | 'column' | 'value';
  description: string;
}

export interface ParseResult {
  intent: 'rule' | 'column' | 'value' | 'ambiguous';
  humanReadable: string;
  confidence: number;
  rule?: ParsedRule;
  column?: ParsedColumn;
  value?: ParsedValue;
  options?: AmbiguousOption[];
}

export class AIValidationError extends Error {
  readonly status = 422;
  constructor(public readonly userError: string, public readonly detail: string) {
    super(userError);
    this.name = 'AIValidationError';
  }
}

// ─── Tool input shapes (mirror the JSON schemas in prompts/tools.ts) ───

interface GetFunctionDetailsInput { names: string[] }
interface AskUserToClarifyInput   { question: string }
interface SubmitExpressionInput   {
  intent: 'rule' | 'column' | 'value' | 'ambiguous';
  humanReadable: string;
  confidence: number;
  rule?: ParsedRule;
  column?: ParsedColumn;
  value?: ParsedValue;
  options?: AmbiguousOption[];
}

// ─── Helpers ───

function buildInitialUserMessage(req: AIParseRequest): string {
  const parts = [
    'User input:',
    req.input,
    '',
    'Catalog index:',
    JSON.stringify(req.index, null, 2),
  ];
  if (req.existingRules?.length) {
    parts.push('', `Active rules (avoid exact-name duplicates): ${req.existingRules.join(', ')}`);
  }
  parts.push(
    '',
    'Pick the functions you need from the index, call getFunctionDetails to learn their argument shapes, then call submitExpression. Call askUserToClarify only if the request is genuinely ambiguous.',
  );
  return parts.join('\n');
}

function resolveFunctionDetails(names: string[]): unknown[] {
  const out: unknown[] = [];
  for (const name of names) {
    const spec = FUNCTION_CATALOG.find((f) => f.technicalName === name);
    if (!spec) {
      out.push({ name, error: 'Unknown function. Check spelling against the index.' });
      continue;
    }
    if (spec.status !== 'live') {
      out.push({
        name,
        error: `Function "${name}" is ${spec.status} — not currently runnable. Pick a 'live' function instead.`,
      });
      continue;
    }
    out.push(serializeFunctionSpec(spec));
  }
  return out;
}

function serializeFunctionSpec(spec: FunctionSpec): unknown {
  return {
    name: spec.technicalName,
    friendlyName: spec.friendlyName,
    category: spec.category,
    subgroup: spec.subgroup,
    description: spec.kidDescription,
    args: spec.args.map((a) => ({
      name: a.name,
      kind: a.kind,
      description: a.description,
      allowed: a.allowed,
    })),
    rest: spec.rest
      ? { kind: spec.rest.kind, description: spec.rest.description, minCount: spec.rest.minCount }
      : undefined,
    returns: spec.returns,
    example: spec.example,
    exampleMeaning: spec.exampleMeaning,
    notes: {
      isSnapshotAware: spec.isSnapshotAware,
      isTimeAware: spec.isTimeAware,
      isHistorical: spec.isHistorical,
    },
  };
}

function validateSubmission(
  input: SubmitExpressionInput,
  columns: readonly ColumnLike[],
  symbol: string | undefined,
): ValidationResult {
  const sample = symbol ? getAtmRow(symbol) : null;
  if (input.intent === 'rule') {
    if (!input.rule) return { ok: false, error: 'rule payload missing', detail: 'intent="rule" but rule is undefined' };
    return validateBooleanExpression(input.rule.expression, sample, columns);
  }
  if (input.intent === 'column') {
    if (!input.column) return { ok: false, error: 'column payload missing', detail: 'intent="column" but column is undefined' };
    return validateNumericExpression(input.column.expression, sample, columns);
  }
  if (input.intent === 'value') {
    if (!input.value) return { ok: false, error: 'value payload missing', detail: 'intent="value" but value is undefined' };
    return validateValueExpression(input.value.expression, sample, columns);
  }
  // ambiguous — must carry options
  if (!input.options?.length) {
    return { ok: false, error: 'options missing', detail: 'intent="ambiguous" but options is empty. Provide 2–3 options or pick a concrete intent.' };
  }
  return { ok: true };
}

function clampConfidence(c: number): number {
  if (typeof c !== 'number' || !Number.isFinite(c)) return 0.7;
  return Math.max(0, Math.min(1, c));
}

function normalizeSubmission(input: SubmitExpressionInput): ParseResult {
  const out: ParseResult = {
    intent: input.intent,
    humanReadable: input.humanReadable ?? '',
    confidence: clampConfidence(input.confidence),
  };
  if (input.rule) out.rule = input.rule;
  if (input.column) {
    out.column = {
      ...input.column,
      format: {
        type: input.column.format.type,
        decimals: Math.max(0, Math.min(6, Math.round(input.column.format.decimals))),
      },
    };
  }
  if (input.value) {
    out.value = {
      ...input.value,
      format: {
        type: input.value.format.type,
        decimals: Math.max(0, Math.min(6, Math.round(input.value.format.decimals))),
      },
    };
  }
  if (input.options) out.options = input.options;
  return out;
}

// ─── Tool-use loop ───

export async function parseAi(req: AIParseRequest): Promise<AIParseResponse> {
  const t0 = Date.now();
  const c = getClient();

  // Build (or resume) the message history. A resumed turn appends the user's
  // clarification answer; the prior state already ends with an assistant
  // askUserToClarify + a tool_result placeholder, so the new user message
  // becomes a fresh turn the model reads as the answer.
  let messages: Anthropic.MessageParam[];
  if (req.state) {
    messages = [...req.state.messages, { role: 'user', content: req.input }];
  } else {
    messages = [{ role: 'user', content: buildInitialUserMessage(req) }];
  }

  const columns = req.columns ?? [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await c.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: PARSE_SYSTEM_PROMPT,
      tools: PARSE_TOOLS,
      messages,
    });
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Append the assistant turn verbatim — content blocks carry the tool_use
    // blocks the next user turn must correlate against via tool_use_id.
    messages.push({ role: 'assistant', content: response.content });

    // Sometimes the model ends with plain text instead of a tool call (most
    // common on vague queries — it tries to answer in prose). Nudge it back
    // with a fresh user turn rather than failing the whole request.
    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const seen = textBlock && 'text' in textBlock ? textBlock.text.slice(0, 200) : '(no text)';
      messages.push({
        role: 'user',
        content: `Your reply was plain text ("${seen}"). You must always end with a tool call — submitExpression (intent rule|column|ambiguous), askUserToClarify, or getFunctionDetails. Pick one and try again.`,
      });
      continue;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let terminated: { type: 'result'; data: ParseResult } | { type: 'clarification'; question: string } | null = null;

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      if (block.name === 'getFunctionDetails') {
        const inp = block.input as GetFunctionDetailsInput;
        const details = resolveFunctionDetails(Array.isArray(inp?.names) ? inp.names : []);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(details),
        });
        continue;
      }

      if (block.name === 'askUserToClarify') {
        const inp = block.input as AskUserToClarifyInput;
        const question = (inp?.question ?? '').toString().trim();
        if (!question) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Question was empty. Provide a non-empty question or proceed without clarification.',
            is_error: true,
          });
          continue;
        }
        // Persist a placeholder tool_result so the message history stays
        // valid for replay. The user's answer comes in as a fresh user turn.
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: '<awaiting user clarification>',
        });
        terminated = { type: 'clarification', question };
        break;
      }

      if (block.name === 'submitExpression') {
        const inp = block.input as SubmitExpressionInput;
        const v = validateSubmission(inp, columns, req.symbol);
        if (v.ok) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'OK — submission accepted.',
          });
          terminated = { type: 'result', data: normalizeSubmission(inp) };
          break;
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Your previous submitExpression failed validation: ${v.detail}\nFix the issue and call submitExpression again.`,
          is_error: true,
        });
        continue;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Unknown tool "${block.name}".`,
        is_error: true,
      });
    }

    messages.push({ role: 'user', content: toolResults });

    if (terminated?.type === 'clarification') {
      logTiming('clarify', t0, totalInputTokens, totalOutputTokens, req.input);
      return {
        kind: 'clarification',
        question: terminated.question,
        state: { messages },
      };
    }
    if (terminated?.type === 'result') {
      logTiming('result', t0, totalInputTokens, totalOutputTokens, req.input);
      return { kind: 'result', result: terminated.data };
    }
  }

  throw new Error(`Tool-use loop exceeded ${MAX_TOOL_ITERATIONS} iterations without a terminator.`);
}

function logTiming(label: string, t0: number, inputTokens: number, outputTokens: number, input: string): void {
  console.log(
    `[ai/parse] ${label} ${Date.now() - t0}ms · in=${inputTokens} out=${outputTokens}`
    + ` · "${input.slice(0, 60)}${input.length > 60 ? '…' : ''}"`,
  );
}
