import type { CustomColumnDefinition, RuleDefinition, ValueDefinition } from './types';

// 10 predefined rules expressed as single boolean-rooted expressions.
//
// Each rule's `slider.literalOffset` points at the bound literal's first
// character in `expression`. For unary-negative literals (e.g. `-5000`),
// the offset points at the `-`, so the slider span covers the whole `-N`.
//
// Offsets were precomputed by hand against the literal strings below;
// migration of old multi-condition rules from localStorage is handled in
// persistence.ts.

export const PREDEFINED_RULES: RuleDefinition[] = [
  {
    id: 'highCallOi',
    name: 'High Call OI',
    description: 'Strikes with call OI above an absolute threshold — likely resistance.',
    enabled: true,
    expression: 'call_oi > 80000',
    hue: 210,
    slider: { literalOffset: 10, min: 0, max: 500_000, step: 1000, label: 'Min Call OI' },
  },
  {
    id: 'highPutOi',
    name: 'High Put OI',
    description: 'Strikes with put OI above an absolute threshold — likely support.',
    enabled: true,
    expression: 'put_oi > 80000',
    hue: 280,
    slider: { literalOffset: 9, min: 0, max: 500_000, step: 1000, label: 'Min Put OI' },
  },
  {
    id: 'ivSkew',
    name: 'IV Skew',
    description: 'Calls/Puts IV diverge by more than threshold — mispricing or directional bias.',
    enabled: false,
    expression: 'abs(call_iv - put_iv) > 5',
    hue: 38,
    slider: { literalOffset: 24, min: 0, max: 20, step: 0.5, label: 'Min IV gap (%)' },
  },
  {
    id: 'callOiBuildup',
    name: 'Call OI Buildup',
    description: 'Fresh call positions added — typically bearish above spot.',
    enabled: true,
    expression: 'call_oiChange > 5000',
    hue: 142,
    slider: { literalOffset: 16, min: 0, max: 50_000, step: 500, label: 'Min ΔOI' },
  },
  {
    id: 'callOiUnwind',
    name: 'Call OI Unwinding',
    description: 'Calls being closed — bullish signal.',
    enabled: true,
    expression: 'call_oiChange < -5000',
    hue: 0,
    slider: { literalOffset: 16, min: -50_000, max: 0, step: 500, label: 'Max ΔOI' },
  },
  {
    id: 'putOiBuildup',
    name: 'Put OI Buildup',
    description: 'Fresh put positions — bullish below spot (support).',
    enabled: false,
    expression: 'put_oiChange > 5000',
    hue: 168,
    slider: { literalOffset: 15, min: 0, max: 50_000, step: 500, label: 'Min ΔOI' },
  },
  {
    id: 'putOiUnwind',
    name: 'Put OI Unwinding',
    description: 'Puts being closed — bearish signal.',
    enabled: false,
    expression: 'put_oiChange < -5000',
    hue: 12,
    slider: { literalOffset: 15, min: -50_000, max: 0, step: 500, label: 'Max ΔOI' },
  },
  {
    id: 'pcrBullish',
    name: 'PCR Bullish',
    description: 'Strike-level PCR > threshold — strong put writing, bullish.',
    enabled: false,
    expression: 'put_oi / call_oi > 1.5',
    hue: 95,
    slider: { literalOffset: 19, min: 1, max: 3, step: 0.05, label: 'Min PCR' },
  },
  {
    id: 'pcrBearish',
    name: 'PCR Bearish',
    description: 'Strike-level PCR < threshold — call writing dominant, bearish.',
    enabled: false,
    expression: 'put_oi / call_oi < 0.5',
    hue: 320,
    slider: { literalOffset: 19, min: 0.1, max: 1, step: 0.05, label: 'Max PCR' },
  },
  {
    id: 'volumeSpike',
    name: 'Volume Spike',
    description: 'Volume more than absolute threshold on either side.',
    enabled: true,
    expression: 'call_volume > 50000 || put_volume > 50000',
    hue: 50,
    slider: { literalOffset: 14, min: 1_000, max: 500_000, step: 1000, label: 'Min volume' },
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

// Pre-loaded values shown in the strip above the table.
// Each is a chain-wide scalar — single number per tick, not per row.
export const PREDEFINED_VALUES: ValueDefinition[] = [
  {
    id: 'val_totalCallOi',
    name: 'totalCallOi',
    displayLabel: 'Total Call OI',
    description: 'Sum of call open interest across all strikes.',
    expression: 'chainSum(call_oi)',
    format: { type: 'number', decimals: 0 },
  },
  {
    id: 'val_totalPutOi',
    name: 'totalPutOi',
    displayLabel: 'Total Put OI',
    description: 'Sum of put open interest across all strikes.',
    expression: 'chainSum(put_oi)',
    format: { type: 'number', decimals: 0 },
  },
  {
    id: 'val_chainPcr',
    name: 'chainPcr',
    displayLabel: 'Chain PCR',
    description: 'Put-to-call OI ratio across the full chain.',
    expression: 'chainSum(put_oi) / chainSum(call_oi)',
    format: { type: 'number', decimals: 2 },
  },
];
