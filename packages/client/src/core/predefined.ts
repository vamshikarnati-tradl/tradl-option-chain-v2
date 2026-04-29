import type { CustomColumnDefinition, RuleDefinition } from './types';

// 10 predefined rules. Hue assignments mirror the design's RULE_PALETTE so the
// shipped product reads as a direct implementation of the mock.
//
// Sliders bind to the rhs literal of the first condition and can be tuned
// from the rule editor. Thresholds default to values that fire on a typical
// Nifty mock chain.

export const PREDEFINED_RULES: RuleDefinition[] = [
  {
    id: 'highCallOi',
    name: 'High Call OI',
    description: 'Strikes with call OI above an absolute threshold — likely resistance.',
    enabled: true,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'field', field: 'call_oi' }, operator: 'gt', rhs: { kind: 'literal', value: 80_000 } },
    ],
    style: { hue: 210, scope: 'call' },
    slider: { conditionIndex: 0, min: 0, max: 500_000, step: 1000, label: 'Min Call OI' },
  },
  {
    id: 'highPutOi',
    name: 'High Put OI',
    description: 'Strikes with put OI above an absolute threshold — likely support.',
    enabled: true,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'field', field: 'put_oi' }, operator: 'gt', rhs: { kind: 'literal', value: 80_000 } },
    ],
    style: { hue: 280, scope: 'put' },
    slider: { conditionIndex: 0, min: 0, max: 500_000, step: 1000, label: 'Min Put OI' },
  },
  {
    id: 'ivSkew',
    name: 'IV Skew',
    description: 'Calls/Puts IV diverge by more than threshold — mispricing or directional bias.',
    enabled: false,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'expr', expression: 'abs(call_iv - put_iv)' }, operator: 'gt', rhs: { kind: 'literal', value: 5 } },
    ],
    style: { hue: 38, scope: 'row' },
    slider: { conditionIndex: 0, min: 0, max: 20, step: 0.5, label: 'Min IV gap (%)' },
  },
  {
    id: 'callOiBuildup',
    name: 'Call OI Buildup',
    description: 'Fresh call positions added — typically bearish above spot.',
    enabled: true,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'field', field: 'call_oiChange' }, operator: 'gt', rhs: { kind: 'literal', value: 5_000 } },
    ],
    style: { hue: 142, scope: 'call' },
    slider: { conditionIndex: 0, min: 0, max: 50_000, step: 500, label: 'Min ΔOI' },
  },
  {
    id: 'callOiUnwind',
    name: 'Call OI Unwinding',
    description: 'Calls being closed — bullish signal.',
    enabled: true,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'field', field: 'call_oiChange' }, operator: 'lt', rhs: { kind: 'literal', value: -5_000 } },
    ],
    style: { hue: 0, scope: 'call' },
    slider: { conditionIndex: 0, min: -50_000, max: 0, step: 500, label: 'Max ΔOI' },
  },
  {
    id: 'putOiBuildup',
    name: 'Put OI Buildup',
    description: 'Fresh put positions — bullish below spot (support).',
    enabled: false,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'field', field: 'put_oiChange' }, operator: 'gt', rhs: { kind: 'literal', value: 5_000 } },
    ],
    style: { hue: 168, scope: 'put' },
    slider: { conditionIndex: 0, min: 0, max: 50_000, step: 500, label: 'Min ΔOI' },
  },
  {
    id: 'putOiUnwind',
    name: 'Put OI Unwinding',
    description: 'Puts being closed — bearish signal.',
    enabled: false,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'field', field: 'put_oiChange' }, operator: 'lt', rhs: { kind: 'literal', value: -5_000 } },
    ],
    style: { hue: 12, scope: 'put' },
    slider: { conditionIndex: 0, min: -50_000, max: 0, step: 500, label: 'Max ΔOI' },
  },
  {
    id: 'pcrBullish',
    name: 'PCR Bullish',
    description: 'Strike-level PCR > threshold — strong put writing, bullish.',
    enabled: false,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'expr', expression: 'put_oi / call_oi' }, operator: 'gt', rhs: { kind: 'literal', value: 1.5 } },
    ],
    style: { hue: 95, scope: 'row' },
    slider: { conditionIndex: 0, min: 1, max: 3, step: 0.05, label: 'Min PCR' },
  },
  {
    id: 'pcrBearish',
    name: 'PCR Bearish',
    description: 'Strike-level PCR < threshold — call writing dominant, bearish.',
    enabled: false,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'expr', expression: 'put_oi / call_oi' }, operator: 'lt', rhs: { kind: 'literal', value: 0.5 } },
    ],
    style: { hue: 320, scope: 'row' },
    slider: { conditionIndex: 0, min: 0.1, max: 1, step: 0.05, label: 'Max PCR' },
  },
  {
    id: 'volumeSpike',
    name: 'Volume Spike',
    description: 'Volume more than absolute threshold on either side.',
    enabled: true,
    logic: 'OR',
    conditions: [
      { lhs: { kind: 'field', field: 'call_volume' }, operator: 'gt', rhs: { kind: 'literal', value: 50_000 } },
      { lhs: { kind: 'field', field: 'put_volume' }, operator: 'gt', rhs: { kind: 'literal', value: 50_000 } },
    ],
    style: { hue: 50, scope: 'row' },
    slider: { conditionIndex: 0, min: 1_000, max: 500_000, step: 1000, label: 'Min volume' },
  },
];

// Pre-loaded read-only columns — match the design's PCR + Straddle.
export const PREDEFINED_COLUMNS: CustomColumnDefinition[] = [
  {
    id: 'col_pcr',
    name: 'PCR',
    expression: 'put_oi / call_oi',
    format: { type: 'number', decimals: 2 },
    side: 'general',
  },
  {
    id: 'col_str',
    name: 'Straddle',
    expression: 'call_ltp + put_ltp',
    format: { type: 'number', decimals: 2 },
    side: 'general',
  },
];
