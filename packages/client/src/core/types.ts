import type { OptionChainRow, NumericField } from '@tradl/shared';
export type { OptionChainRow, NumericField } from '@tradl/shared';
export { NUMERIC_FIELDS } from '@tradl/shared';

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
  // Union of NumericField deps across the conditions that matched. Drives
  // per-cell tinting: a cell at (strike, field) is tinted by this rule iff
  // `field` appears here. Empty array means the rule's coloring should not
  // be cell-scoped (defensive — should not happen for any predicate).
  affectedFields: NumericField[];
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
