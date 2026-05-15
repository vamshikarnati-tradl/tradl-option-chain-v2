// /api/ai/refine-expression — tool-use loop variant.
//
// Same loop shape as ai-parse but with a single terminator
// (submitNewExpression). The kind ('rule' | 'column') decides the root-type
// constraint enforced by the validator.

import Anthropic from '@anthropic-ai/sdk';
import { FUNCTION_CATALOG, type FunctionSpec } from '@tradl/shared';
import { REFINE_SYSTEM_PROMPT_RULE, REFINE_SYSTEM_PROMPT_COLUMN } from './prompts/refine.js';
import { REFINE_TOOLS } from './prompts/tools.js';
import {
  validateBooleanExpression, validateNumericExpression,
  type ColumnLike, type ValidationResult,
} from './ai-validator.js';
import { getAtmRow } from './snapshot-store.js';
import type { ConversationState } from './ai-parse.js';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  client = new Anthropic();
  return client;
}

const MAX_TOOL_ITERATIONS = 8;

export type RefineKind = 'rule' | 'column';

export interface RefineRequest {
  currentExpression: string;
  instruction: string;
  /** Compact catalog index. */
  index?: unknown;
  /** Raw column defs for column-aware validation. */
  columns?: ColumnLike[];
  symbol?: string;
  kind?: RefineKind;
  /** Opaque blob returned on prior clarification. Replayed verbatim. */
  state?: ConversationState;
}

export interface RefineResult {
  newExpression: string;
  humanReadable: string;
  confidence: number;
}

export type RefineResponse =
  | { kind: 'result'; result: RefineResult }
  | { kind: 'clarification'; question: string; state: ConversationState };

interface GetFunctionDetailsInput { names: string[] }
interface AskUserToClarifyInput   { question: string }
interface SubmitNewExpressionInput {
  newExpression: string;
  humanReadable: string;
  confidence: number;
}

function buildInitialUserMessage(req: RefineRequest): string {
  const parts = [
    `Current expression: ${req.currentExpression}`,
    `User instruction: ${req.instruction}`,
  ];
  if (req.index) {
    parts.push('', 'Catalog index:', JSON.stringify(req.index, null, 2));
  }
  parts.push(
    '',
    'Pick the functions you need from the index, call getFunctionDetails to learn their argument shapes, then call submitNewExpression. Call askUserToClarify only if the instruction is genuinely ambiguous.',
  );
  return parts.join('\n');
}

function serializeFunctionSpec(spec: FunctionSpec): unknown {
  return {
    name: spec.technicalName,
    friendlyName: spec.friendlyName,
    category: spec.category,
    subgroup: spec.subgroup,
    description: spec.kidDescription,
    args: spec.args.map((a) => ({
      name: a.name, kind: a.kind, description: a.description, allowed: a.allowed,
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

function resolveFunctionDetails(names: string[]): unknown[] {
  const out: unknown[] = [];
  for (const name of names) {
    const spec = FUNCTION_CATALOG.find((f) => f.technicalName === name);
    if (!spec) { out.push({ name, error: 'Unknown function.' }); continue; }
    if (spec.status !== 'live') {
      out.push({ name, error: `Function "${name}" is ${spec.status} — not currently runnable.` });
      continue;
    }
    out.push(serializeFunctionSpec(spec));
  }
  return out;
}

function clampConfidence(c: number): number {
  if (typeof c !== 'number' || !Number.isFinite(c)) return 0.7;
  return Math.max(0, Math.min(1, c));
}

function validateSubmission(
  expr: string,
  kind: RefineKind,
  columns: readonly ColumnLike[],
  symbol: string | undefined,
): ValidationResult {
  const sample = symbol ? getAtmRow(symbol) : null;
  return kind === 'column'
    ? validateNumericExpression(expr, sample, columns)
    : validateBooleanExpression(expr, sample, columns);
}

export async function refineExpression(req: RefineRequest): Promise<RefineResponse> {
  const t0 = Date.now();
  const c = getClient();
  const kind: RefineKind = req.kind === 'column' ? 'column' : 'rule';
  const system = kind === 'column' ? REFINE_SYSTEM_PROMPT_COLUMN : REFINE_SYSTEM_PROMPT_RULE;
  const columns = req.columns ?? [];

  let messages: Anthropic.MessageParam[];
  if (req.state) {
    messages = [...req.state.messages, { role: 'user', content: req.instruction }];
  } else {
    messages = [{ role: 'user', content: buildInitialUserMessage(req) }];
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await c.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system,
      tools: REFINE_TOOLS,
      messages,
    });
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const seen = textBlock && 'text' in textBlock ? textBlock.text.slice(0, 200) : '(no text)';
      messages.push({
        role: 'user',
        content: `Your reply was plain text ("${seen}"). You must always end with a tool call — submitNewExpression, askUserToClarify, or getFunctionDetails. Pick one and try again.`,
      });
      continue;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let terminated: { type: 'result'; data: RefineResult } | { type: 'clarification'; question: string } | null = null;

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      if (block.name === 'getFunctionDetails') {
        const inp = block.input as GetFunctionDetailsInput;
        const details = resolveFunctionDetails(Array.isArray(inp?.names) ? inp.names : []);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(details) });
        continue;
      }

      if (block.name === 'askUserToClarify') {
        const inp = block.input as AskUserToClarifyInput;
        const question = (inp?.question ?? '').toString().trim();
        if (!question) {
          toolResults.push({
            type: 'tool_result', tool_use_id: block.id,
            content: 'Question was empty. Provide a non-empty question or proceed without clarification.',
            is_error: true,
          });
          continue;
        }
        toolResults.push({
          type: 'tool_result', tool_use_id: block.id,
          content: '<awaiting user clarification>',
        });
        terminated = { type: 'clarification', question };
        break;
      }

      if (block.name === 'submitNewExpression') {
        const inp = block.input as SubmitNewExpressionInput;
        const expr = (inp?.newExpression ?? '').toString();
        const v = validateSubmission(expr, kind, columns, req.symbol);
        if (v.ok) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'OK — submission accepted.' });
          terminated = {
            type: 'result',
            data: {
              newExpression: expr,
              humanReadable: inp.humanReadable ?? '',
              confidence: clampConfidence(inp.confidence),
            },
          };
          break;
        }
        toolResults.push({
          type: 'tool_result', tool_use_id: block.id,
          content: `Your previous submitNewExpression failed validation: ${v.detail}\nFix the issue and call submitNewExpression again.`,
          is_error: true,
        });
        continue;
      }

      toolResults.push({
        type: 'tool_result', tool_use_id: block.id,
        content: `Unknown tool "${block.name}".`,
        is_error: true,
      });
    }

    messages.push({ role: 'user', content: toolResults });

    if (terminated?.type === 'clarification') {
      logTiming('clarify', t0, kind, totalInputTokens, totalOutputTokens, req.instruction);
      return { kind: 'clarification', question: terminated.question, state: { messages } };
    }
    if (terminated?.type === 'result') {
      logTiming('result', t0, kind, totalInputTokens, totalOutputTokens, req.instruction);
      return { kind: 'result', result: terminated.data };
    }
  }

  throw new Error(`Tool-use loop exceeded ${MAX_TOOL_ITERATIONS} iterations without a terminator.`);
}

function logTiming(
  label: string, t0: number, kind: RefineKind,
  inputTokens: number, outputTokens: number, instruction: string,
): void {
  console.log(
    `[ai/refine-expression] ${label} ${Date.now() - t0}ms · kind=${kind} · in=${inputTokens} out=${outputTokens}`
    + ` · "${instruction.slice(0, 60)}${instruction.length > 60 ? '…' : ''}"`,
  );
}
