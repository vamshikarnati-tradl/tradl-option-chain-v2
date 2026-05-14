import Anthropic from '@anthropic-ai/sdk';
import { PARSE_SYSTEM_PROMPT } from './prompts/parse.js';
import { PARSE_RESPONSE_SCHEMA } from './prompts/parse-schema.js';
import { validateColumn, validateRule, type ValidationResult } from './ai-validator.js';
import { getAtmRow } from './snapshot-store.js';

// Lazy client init — server should boot fine without ANTHROPIC_API_KEY;
// only the /api/ai/parse route fails when the key is missing.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  client = new Anthropic();
  return client;
}

// ─── Request / response types (mirror the client's expectations) ───

export interface AITurnEntry {
  userText: string;
  assistantJson: string;
}

export interface AIParseRequest {
  input: string;
  availableFields: string[];
  existingRules: string[];
  existingColumns: string[];
  // Identifies which symbol's most-recent snapshot the server should pick its
  // dry-run sample row from. Optional — without a snapshot the validator skips
  // the dry-run check (parse + field-allowlist still run).
  symbol?: string;
  // Prior conversation turns (oldest → newest). The server replays them as
  // user/assistant pairs before the new user turn so the model can refine its
  // previous answer. Capped to MAX_HISTORY_TURNS to bound payload + cost.
  history?: AITurnEntry[];
}

const MAX_HISTORY_TURNS = 4;

// Thrown when the LLM's draft fails validation. The route handler converts it
// into a 422 response. `detail` is the longer message used for the LLM repair
// retry; `error` is the user-facing one-line summary.
export class AIValidationError extends Error {
  readonly status = 422;
  constructor(
    public readonly userError: string,
    public readonly detail: string,
    public readonly draft: AIParseResponse,
  ) {
    super(userError);
    this.name = 'AIValidationError';
  }
}

type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

interface ConditionLhs {
  kind: 'field' | 'expr';
  field?: string;
  expression?: string;
}
interface ConditionRhs {
  kind: 'literal' | 'field' | 'expr';
  value?: number;
  field?: string;
  expression?: string;
}
interface Condition {
  lhs: ConditionLhs;
  operator: Operator;
  rhs: ConditionRhs;
}
interface ParsedRule {
  name: string;
  description: string;
  logic: 'AND' | 'OR';
  scope: 'call' | 'put' | 'row';
  conditions: Condition[];
}
interface ParsedColumn {
  name: string;
  expression: string;
  format: { type: 'number' | 'percentage' | 'currency'; decimals: number };
}
interface AmbiguousOption {
  label: string;
  intent: 'rule' | 'column';
  description: string;
}

export interface AIParseResponse {
  intent: 'rule' | 'column' | 'ambiguous';
  humanReadable: string;
  // 0..1 — how confident the model is in its parse. Coarse signal driving
  // the green/yellow/red confidence bar and the "best guess" warning banner.
  confidence: number;
  rule?: ParsedRule;
  column?: ParsedColumn;
  options?: AmbiguousOption[];
  // Set when the server's self-repair retry produced this result (the first
  // LLM draft failed validation and was corrected on a second pass). The
  // client surfaces a subtle "AI corrected its draft" hint.
  repaired?: boolean;
}

function buildUserMessage(req: AIParseRequest): string {
  const lines = [`User input: "${req.input}"`];
  if (req.existingRules.length) {
    lines.push(`Active rules (avoid exact-name duplication): ${req.existingRules.join(', ')}`);
  }
  if (req.existingColumns.length) {
    // Saved columns can be referenced by name inside expressions, the same
    // way raw data fields can. The model should prefer referencing an
    // existing column over re-inlining its formula.
    lines.push(`Active columns (reference by name; avoid exact-name duplication): ${req.existingColumns.join(', ')}`);
  }
  lines.push('Parse this and respond with the JSON object only.');
  return lines.join('\n');
}

type Turn = { role: 'user' | 'assistant'; content: string };

async function callLlm(messages: Turn[]): Promise<{ parsed: AIParseResponse; rawJson: string; usage: Anthropic.Usage }> {
  const c = getClient();
  const response = (await c.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 768,
    system: PARSE_SYSTEM_PROMPT,
    messages,
    // `output_config` is the GA structured-output knob; cast to bypass the
    // SDK's older typed params shape.
    ...({
      output_config: {
        format: {
          type: 'json_schema',
          schema: PARSE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    } as Record<string, unknown>),
  } as Anthropic.MessageCreateParams)) as Anthropic.Message;

  const block = response.content[0];
  if (block?.type !== 'text') {
    throw new Error('Empty response from model');
  }
  const rawJson = block.text;
  const parsed = JSON.parse(rawJson) as AIParseResponse;

  if (parsed.column?.format) {
    const d = parsed.column.format.decimals;
    parsed.column.format.decimals = Math.max(0, Math.min(6, Math.round(d)));
  }
  if (typeof parsed.confidence === 'number') {
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
  } else {
    parsed.confidence = 0.7;
  }

  return { parsed, rawJson, usage: response.usage };
}

function logTiming(label: string, t0: number, usage: Anthropic.Usage, input: string): void {
  console.log(
    `[ai/parse] ${label} ${Date.now() - t0}ms · in=${usage.input_tokens} out=${usage.output_tokens}`
    + (usage.cache_read_input_tokens ? ` cache_read=${usage.cache_read_input_tokens}` : '')
    + ` · "${input.slice(0, 60)}${input.length > 60 ? '…' : ''}"`,
  );
}

function buildRepairMessage(failure: { error: string; detail: string }, prevDraftJson: string): string {
  return [
    `Your previous response failed validation: ${failure.detail}`,
    `Previous draft: ${prevDraftJson}`,
    `Fix the issue and respond with the corrected JSON object only.`,
  ].join('\n');
}

function historyTurns(req: AIParseRequest): Turn[] {
  if (!req.history?.length) return [];
  const slice = req.history.slice(-MAX_HISTORY_TURNS);
  const out: Turn[] = [];
  for (const h of slice) {
    out.push({ role: 'user', content: h.userText });
    out.push({ role: 'assistant', content: h.assistantJson });
  }
  return out;
}

export async function parseAi(req: AIParseRequest): Promise<AIParseResponse> {
  const t0 = Date.now();
  const userMsg = buildUserMessage(req);
  const baseMsgs: Turn[] = [...historyTurns(req), { role: 'user', content: userMsg }];
  const first = await callLlm(baseMsgs);
  logTiming(req.history?.length ? 'refine' : 'draft', t0, first.usage, req.input);

  const firstCheck = validateDraft(first.parsed, req.symbol);
  if (firstCheck.ok) return first.parsed;

  // First draft failed validation → one self-repair retry with the validator
  // error fed back to the LLM as a fresh user turn.
  const t1 = Date.now();
  const repairMsgs: Turn[] = [
    ...baseMsgs,
    { role: 'assistant', content: first.rawJson },
    { role: 'user', content: buildRepairMessage(firstCheck, first.rawJson) },
  ];
  const second = await callLlm(repairMsgs);
  logTiming('repair', t1, second.usage, req.input);

  const secondCheck = validateDraft(second.parsed, req.symbol);
  if (secondCheck.ok) {
    second.parsed.repaired = true;
    return second.parsed;
  }
  throw new AIValidationError(secondCheck.error, secondCheck.detail, second.parsed);
}

// Validate the parsed draft (rule/column expressions) against the shared parser,
// the field allowlist, and a dry-run on the ATM sample row. Ambiguous drafts
// have no expressions to validate so they pass through.
function validateDraft(parsed: AIParseResponse, symbol: string | undefined): ValidationResult {
  const sample = symbol ? getAtmRow(symbol) : null;
  if (parsed.intent === 'column' && parsed.column) {
    return validateColumn(parsed.column, sample);
  }
  if (parsed.intent === 'rule' && parsed.rule) {
    return validateRule(parsed.rule, sample);
  }
  return { ok: true };
}
