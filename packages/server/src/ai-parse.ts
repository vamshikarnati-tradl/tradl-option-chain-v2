import Anthropic from '@anthropic-ai/sdk';

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

export interface AIParseRequest {
  input: string;
  availableFields: string[];
  existingRules: string[];
  existingColumns: string[];
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
}

// ─── Prompt ───
//
// Bias the model toward our exact data shape (lhs/operator/rhs with kind
// discriminators) so the parsed JSON drops straight into the existing engine
// without translation. Few-shot examples cover all three intents and both
// field-vs-expression LHS forms.

const SYSTEM_PROMPT = `You are a parser. Convert natural-language descriptions of option-chain rules and calculations into strict JSON. Respond with the JSON object only — no preamble, no markdown fences.

# Data fields (all numeric)
strikePrice, underlyingValue,
call_oi, call_oiChange, call_volume, call_iv, call_ltp, call_netChange,
call_bidQty, call_bidPrice, call_askQty, call_askPrice,
put_oi, put_oiChange, put_volume, put_iv, put_ltp, put_netChange,
put_bidQty, put_bidPrice, put_askQty, put_askPrice

# Intent classification
- "rule": user wants to highlight, flag, mark, or alert when a condition is met. Triggers: "highlight", "show me where", "flag rows where", "alert when", "mark strikes that".
- "column": user wants a calculation displayed as a new column. Triggers: "add a column for", "calculate", "show the ratio of", "compute".
- "ambiguous": the request could plausibly be either. Return options.

# Rule shape
{
  "name": <short descriptive title>,
  "description": <one sentence explaining what it flags>,
  "logic": "AND" | "OR",
  "scope": "call" | "put" | "row",
  "conditions": [{
    "lhs": { "kind": "field", "field": <fieldName> }   // OR
          | { "kind": "expr",  "expression": <math string> },
    "operator": "gt" | "gte" | "lt" | "lte" | "eq" | "neq",
    "rhs": { "kind": "literal", "value": <number> }   // OR
         | { "kind": "field",   "field": <fieldName> }   // OR
         | { "kind": "expr",    "expression": <math string> }
  }, ...]
}

Choose scope based on which side of the table the highlight should color: "call" if only call-side data is involved, "put" if only put-side, "row" if it spans both sides or makes sense as a whole-row tint.

# Column shape
{
  "name": <short header>,
  "expression": <math string>,
  "format": { "type": "number" | "percentage" | "currency", "decimals": <int 0..6> }
}

# Expression syntax (for both lhs/rhs expr and column expressions)
Operators: + - * / %, comparison > < >= <= == !=, logical && || !, ternary ?:
Functions: abs, min, max, round, floor, ceil, sqrt, pow, log, exp
Constants: PI, E
Field names from the list above.

# Always-included
Always include:
- "humanReadable": a one-line plain-text summary of the parsed result.
- "confidence": a number 0..1 representing how confidently you parsed the user's intent.
  - 0.90+ when the input names a specific field and operator unambiguously ("call_iv > 16", "straddle price").
  - 0.70–0.89 when interpretation was needed but the meaning is clear ("flag big put walls" → high put OI rule).
  - 0.50–0.69 when you had to make a judgment call about scope, threshold, or which side ("show me unusual things").
  - 0.30–0.49 when the input is vague or could plausibly mean several things ("interesting strikes").
  - Use ambiguous intent (not low confidence) when there are 2-3 distinct interpretations the user might pick between.

# Examples

Input: "show me where call IV is above 16"
{"intent":"rule","confidence":0.97,"humanReadable":"call_iv > 16","rule":{"name":"High Call IV","description":"Strikes where call IV is above 16%.","logic":"AND","scope":"call","conditions":[{"lhs":{"kind":"field","field":"call_iv"},"operator":"gt","rhs":{"kind":"literal","value":16}}]}}

Input: "highlight strikes where put OI is more than 3 times call OI"
{"intent":"rule","confidence":0.95,"humanReadable":"put_oi > call_oi * 3","rule":{"name":"Put OI Dominance","description":"Strikes where put open interest exceeds 3× call open interest.","logic":"AND","scope":"put","conditions":[{"lhs":{"kind":"field","field":"put_oi"},"operator":"gt","rhs":{"kind":"expr","expression":"call_oi * 3"}}]}}

Input: "highlight where IV gap exceeds 5"
{"intent":"rule","confidence":0.92,"humanReadable":"abs(call_iv - put_iv) > 5","rule":{"name":"IV Skew","description":"Strikes where call/put IV diverges by more than 5 points.","logic":"AND","scope":"row","conditions":[{"lhs":{"kind":"expr","expression":"abs(call_iv - put_iv)"},"operator":"gt","rhs":{"kind":"literal","value":5}}]}}

Input: "moneyness as a percentage"
{"intent":"column","confidence":0.95,"humanReadable":"(strikePrice - underlyingValue) / underlyingValue * 100","column":{"name":"Moneyness","expression":"(strikePrice - underlyingValue) / underlyingValue * 100","format":{"type":"percentage","decimals":2}}}

Input: "put call ratio"
{"intent":"ambiguous","confidence":0.50,"humanReadable":"put_oi / call_oi","options":[{"label":"Add PCR column","intent":"column","description":"Show put_oi / call_oi for each strike."},{"label":"Highlight extreme PCR","intent":"rule","description":"Flag strikes where PCR > 1.5 (bullish) or < 0.5 (bearish)."}]}`;

// JSON Schema for the response. The model is constrained to emit exactly this shape.
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['rule', 'column', 'ambiguous'] },
    humanReadable: { type: 'string' },
    confidence: { type: 'number' },
    rule: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        logic: { type: 'string', enum: ['AND', 'OR'] },
        scope: { type: 'string', enum: ['call', 'put', 'row'] },
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              lhs: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', enum: ['field', 'expr'] },
                  field: { type: 'string' },
                  expression: { type: 'string' },
                },
                required: ['kind'],
              },
              operator: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] },
              rhs: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', enum: ['literal', 'field', 'expr'] },
                  value: { type: 'number' },
                  field: { type: 'string' },
                  expression: { type: 'string' },
                },
                required: ['kind'],
              },
            },
            required: ['lhs', 'operator', 'rhs'],
          },
        },
      },
      required: ['name', 'description', 'logic', 'scope', 'conditions'],
    },
    column: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        expression: { type: 'string' },
        format: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['number', 'percentage', 'currency'] },
            decimals: { type: 'integer' },
          },
          required: ['type', 'decimals'],
        },
      },
      required: ['name', 'expression', 'format'],
    },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          intent: { type: 'string', enum: ['rule', 'column'] },
          description: { type: 'string' },
        },
        required: ['label', 'intent', 'description'],
      },
    },
  },
  required: ['intent', 'humanReadable', 'confidence'],
} as const;

function buildUserMessage(req: AIParseRequest): string {
  const lines = [`User input: "${req.input}"`];
  if (req.existingRules.length) {
    lines.push(`Active rules (avoid exact-name duplication): ${req.existingRules.join(', ')}`);
  }
  if (req.existingColumns.length) {
    lines.push(`Active columns (avoid exact-name duplication): ${req.existingColumns.join(', ')}`);
  }
  lines.push('Parse this and respond with the JSON object only.');
  return lines.join('\n');
}

export async function parseAi(req: AIParseRequest): Promise<AIParseResponse> {
  const c = getClient();
  const t0 = Date.now();

  const response = (await c.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 768,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(req) }],
    // `output_config` is the GA structured-output knob; cast to bypass the
    // SDK's older typed params shape.
    ...({
      output_config: {
        format: {
          type: 'json_schema',
          schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    } as Record<string, unknown>),
  } as Anthropic.MessageCreateParams)) as Anthropic.Message;

  // The structured-output path returns one text block whose text is the JSON.
  const block = response.content[0];
  if (block?.type !== 'text') {
    throw new Error('Empty response from model');
  }
  const parsed = JSON.parse(block.text) as AIParseResponse;

  // Clamp values that JSON Schema can't bound (structured outputs reject
  // numerical constraints).
  if (parsed.column?.format) {
    const d = parsed.column.format.decimals;
    parsed.column.format.decimals = Math.max(0, Math.min(6, Math.round(d)));
  }
  if (typeof parsed.confidence === 'number') {
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
  } else {
    parsed.confidence = 0.7;
  }

  const u = response.usage;
  console.log(
    `[ai/parse] ${Date.now() - t0}ms · in=${u.input_tokens} out=${u.output_tokens}`
    + (u.cache_read_input_tokens ? ` cache_read=${u.cache_read_input_tokens}` : '')
    + ` · "${req.input.slice(0, 60)}${req.input.length > 60 ? '…' : ''}"`,
  );
  return parsed;
}
