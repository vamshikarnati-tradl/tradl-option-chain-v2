// Types shared across CommandPalette subcomponents.

export type Status = 'idle' | 'parsing' | 'preview' | 'error';

export const SUGGESTIONS = [
  'highlight strikes where put OI is more than 3× call OI',
  'add a column for straddle price',
  'show me where call IV is above 16',
  'PCR per strike as a percent',
  'flag rows with call OI buildup over 50k',
] as const;

export const PAL_W = 460;
export const PAL_H_EST = 360;
export const PAL_MARGIN = 12;

// Raw condition shape as it arrives from the AI parser. Mirrors the engine
// schema with optional discriminator fields.
export interface RawCondition {
  lhs: { kind: 'field' | 'expr'; field?: string; expression?: string };
  operator: string;
  rhs: { kind: 'literal' | 'field' | 'expr'; value?: number; field?: string; expression?: string };
}
