// /api/ai/refine-expression — takes the user's current expression + a
// natural-language instruction, returns a rewritten expression. Used by both
// the Rule Builder (boolean-root required) and the Column Builder (numeric).
// One auto-repair retry if the LLM's first draft fails validation.

import Anthropic from '@anthropic-ai/sdk';
import {
  REFINE_SYSTEM_PROMPT_RULE, REFINE_SYSTEM_PROMPT_COLUMN, REFINE_RESPONSE_SCHEMA,
} from './prompts/refine.js';
import { validateBooleanExpression, validateNumericExpression } from './ai-validator.js';
import { getAtmRow } from './snapshot-store.js';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  client = new Anthropic();
  return client;
}

export type RefineKind = 'rule' | 'column';

export interface RefineRequest {
  currentExpression: string;
  instruction: string;
  symbol?: string;
  /** Whether to require a boolean root ('rule') or a numeric root ('column').
   *  Defaults to 'rule' for backward compat with earlier rule-only callers. */
  kind?: RefineKind;
  /** Names of saved custom columns the user has. These can be referenced
   *  by name in the rewritten expression (so the model doesn't re-inline
   *  formulas when a column already exists). */
  availableColumns?: string[];
}

export interface RefineResponse {
  newExpression: string;
  humanReadable: string;
  confidence: number;
  /** Set when a self-repair retry was needed. */
  repaired?: boolean;
}

function buildUserMessage(req: RefineRequest, repairHint?: string): string {
  const lines = [
    `Current expression: ${req.currentExpression}`,
    `User instruction: ${req.instruction}`,
  ];
  if (req.availableColumns?.length) {
    lines.push(`Available saved columns (reference by name): ${req.availableColumns.join(', ')}`);
  }
  if (repairHint) {
    lines.push(`\nYour previous reply was rejected because: ${repairHint}\nReturn a corrected JSON object — same shape.`);
  }
  return lines.join('\n');
}

async function callLLM(req: RefineRequest, repairHint?: string): Promise<RefineResponse> {
  const c = getClient();
  const system = req.kind === 'column' ? REFINE_SYSTEM_PROMPT_COLUMN : REFINE_SYSTEM_PROMPT_RULE;
  const response = (await c.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system,
    messages: [{ role: 'user', content: buildUserMessage(req, repairHint) }],
    ...({
      output_config: {
        format: {
          type: 'json_schema',
          schema: REFINE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    } as Record<string, unknown>),
  } as Anthropic.MessageCreateParams)) as Anthropic.Message;

  const block = response.content[0];
  if (block?.type !== 'text') throw new Error('Empty response from model');
  const parsed = JSON.parse(block.text) as RefineResponse;
  if (typeof parsed.confidence === 'number') {
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
  } else {
    parsed.confidence = 0.7;
  }
  return parsed;
}

export async function refineExpression(req: RefineRequest): Promise<RefineResponse> {
  const t0 = Date.now();
  const sample = req.symbol ? getAtmRow(req.symbol) : null;
  const validate = req.kind === 'column' ? validateNumericExpression : validateBooleanExpression;

  let draft = await callLLM(req);
  let v = validate(draft.newExpression, sample);

  if (!v.ok) {
    draft = await callLLM(req, v.detail);
    v = validate(draft.newExpression, sample);
    draft.repaired = true;
  }

  if (!v.ok) {
    const failure = v;
    const err = new Error(failure.error) as Error & { detail?: string; draft?: RefineResponse };
    err.detail = failure.detail;
    err.draft = draft;
    throw err;
  }

  console.log(
    `[ai/refine-expression] ${Date.now() - t0}ms · kind=${req.kind ?? 'rule'} · "${req.instruction.slice(0, 60)}${req.instruction.length > 60 ? '…' : ''}"`,
  );
  return draft;
}
