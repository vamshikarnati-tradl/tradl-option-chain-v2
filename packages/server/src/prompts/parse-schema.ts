// JSON Schema for the structured response from /api/ai/parse. Anthropic
// structured outputs reject numerical constraints (min/max), so decimals are
// clamped server-side post-parse instead.

export const PARSE_RESPONSE_SCHEMA = {
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
