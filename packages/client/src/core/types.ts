export interface OptionChainRow {
  strikePrice: number;
  expiryDate: string;

  call_oi: number;
  call_oiChange: number;
  call_volume: number;
  call_iv: number;
  call_ltp: number;
  call_netChange: number;
  call_bidQty: number;
  call_bidPrice: number;
  call_askQty: number;
  call_askPrice: number;

  put_oi: number;
  put_oiChange: number;
  put_volume: number;
  put_iv: number;
  put_ltp: number;
  put_netChange: number;
  put_bidQty: number;
  put_bidPrice: number;
  put_askQty: number;
  put_askPrice: number;

  underlyingValue: number;
}

export interface OptionChainSnapshot {
  symbol: string;
  expiryDate: string;
  underlyingValue: number;
  fetchedAt: number;
  rows: OptionChainRow[];
}

export type WsServerMessage =
  | { type: 'snapshot'; payload: OptionChainSnapshot }
  | { type: 'error'; message: string };

export type NumericField = Exclude<keyof OptionChainRow, 'expiryDate'>;

export const NUMERIC_FIELDS: readonly NumericField[] = [
  'strikePrice', 'underlyingValue',
  'call_oi', 'call_oiChange', 'call_volume', 'call_iv', 'call_ltp', 'call_netChange',
  'call_bidQty', 'call_bidPrice', 'call_askQty', 'call_askPrice',
  'put_oi', 'put_oiChange', 'put_volume', 'put_iv', 'put_ltp', 'put_netChange',
  'put_bidQty', 'put_bidPrice', 'put_askQty', 'put_askPrice',
];

// ───── Rules ─────

export type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'between';

// LHS is either a single field (fast path) or a free expression.
export type ConditionLhs =
  | { kind: 'field'; field: NumericField }
  | { kind: 'expr'; expression: string };

// RHS is a literal number, a field reference, an expression, or a range (for `between`).
export type ConditionRhs =
  | { kind: 'literal'; value: number }
  | { kind: 'field'; field: NumericField }
  | { kind: 'expr'; expression: string }
  | { kind: 'range'; value: [number, number] };

export interface Condition {
  lhs: ConditionLhs;
  operator: Operator;
  rhs: ConditionRhs;
}

export interface RuleStyle {
  // HSL hue (0–360) — canonical color for the rule. The renderer derives
  // bg/border/swatch from this with a fixed saturation+lightness.
  hue: number;
  scope: 'call' | 'put' | 'row';
  icon?: string;
}

// Optional slider metadata — when present, the rule editor exposes a slider
// that mutates the rhs literal of the condition at `conditionIndex`. Lets
// non-technical users tune predefined rules without touching the conditions.
export interface RuleSlider {
  conditionIndex: number;     // which condition the slider controls (default 0)
  min: number;
  max: number;
  step: number;
  label: string;
}

export interface RuleDefinition {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  logic: 'AND' | 'OR';
  conditions: Condition[];
  style: RuleStyle;
  tooltip?: string;
  slider?: RuleSlider;
}

export interface RuleMatch {
  strikePrice: number;
  matchedConditionIndices: number[];
}

export interface RuleResult {
  ruleId: string;
  matches: RuleMatch[];
}

// ───── Custom columns ─────

export type ColumnFormatType = 'number' | 'percentage' | 'currency';

export interface ColumnFormat {
  type: ColumnFormatType;
  decimals: number;
  colorScale?: { positive: string; negative: string };
}

export interface CustomColumnDefinition {
  id: string;
  name: string;
  expression: string;
  format: ColumnFormat;
  side: 'call' | 'put' | 'general';   // which side of the table to render under
}

export interface ColumnCellResult {
  strikePrice: number;
  value: number | null;
  error?: string;
}

export interface ColumnResult {
  columnId: string;
  values: ColumnCellResult[];
}

// ───── Worker protocol ─────

export type WorkerInMessage =
  | { type: 'UPDATE_DATA'; rows: OptionChainRow[] }
  | { type: 'SET_RULES'; rules: RuleDefinition[] }
  | { type: 'SET_COLUMNS'; columns: CustomColumnDefinition[] };

export type WorkerOutMessage =
  | {
      type: 'COMPUTE_RESULTS';
      ruleResults: RuleResult[];
      columnResults: ColumnResult[];
      computedAt: number;
      durationMs: number;
    }
  | { type: 'COLUMN_ERROR'; columnId: string; error: string };
