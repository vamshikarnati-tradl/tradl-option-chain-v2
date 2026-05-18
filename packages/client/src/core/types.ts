import type { OptionChainRow, NumericField } from '@tradl/shared';
export type { OptionChainRow, NumericField } from '@tradl/shared';
export { NUMERIC_FIELDS } from '@tradl/shared';

export type SnapshotSource = 'tradl-gateway' | 'nse' | 'mock';

export interface OptionChainSnapshot {
  symbol: string;
  expiryDate: string;
  underlyingValue: number;
  fetchedAt: number;
  rows: OptionChainRow[];
  source: SnapshotSource;
}

export type WsServerMessage =
  | { type: 'snapshot'; payload: OptionChainSnapshot }
  | { type: 'error'; message: string };

// ───── Rules ─────
//
// A rule is a single boolean-rooted expression. The AST is the source of
// truth — the engine parses, validates that the root produces true/false,
// and evaluates per row. Cells get tinted by the rule's hue iff the rule
// matched on that row; tint is applied only to the cells whose fields the
// evaluator actually read (via evaluateWithTrace, which respects
// short-circuit and ternary branch selection).

/** Optional slider that binds to one numeric literal inside the expression. */
export interface RuleSlider {
  /** Character position in `expression` of the bound literal. For a unary-minus
   *  literal (e.g. `-5000`), this points at the `-`, and the slider spans the
   *  whole `-N` substring. */
  literalOffset: number;
  min: number;
  max: number;
  step: number;
  label?: string;
}

export interface RuleDefinition {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Single expression whose AST root must evaluate to boolean. */
  expression: string;
  /** HSL hue 0..360 for the tint color. */
  hue: number;
  slider?: RuleSlider;
}

export interface RuleMatch {
  strikePrice: number;
  /** Raw fields actually read on the outer row while evaluating this rule.
   *  Drives per-cell tinting: a cell at (strike, field) is tinted iff
   *  `field` appears here. Respects `||`/`&&` short-circuit + ternary
   *  branch selection. */
  affectedFields: NumericField[];
  /** Saved-column ids referenced by the rule on the outer row. Drives the
   *  column-cell tint: the custom-column cell at this strike picks up the
   *  rule's hue. Mirrors `affectedFields` for column references. */
  affectedColumns: string[];
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
  /** Validated identifier (snake/camelCase, no spaces). Doubles as the symbol
   *  this column is referenced by inside other expressions. */
  name: string;
  /** Optional free-form label shown in the table header + picker + visual
   *  pill. When absent, falls back to `name`. */
  displayLabel?: string;
  description?: string;
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

// ───── Values (chain-wide scalars) ─────
//
// A "value" is a single scalar computed once per chain tick — not per row.
// Examples: max-pain strike, total chain OI, ATM IV. Distinct from columns
// (which produce a value per strike) and rules (which produce a boolean
// per strike). Displayed in the value strip above the table.

export interface ValueDefinition {
  id: string;
  /** Validated identifier; same rules as column names. */
  name: string;
  /** Optional free-form label shown in the value strip. Falls back to `name`. */
  displayLabel?: string;
  description?: string;
  /** Expression must have NO outer-row field references. Outermost call is
   *  typically chainSum/chainAvg/.../firstStrike/evalAt/atStrike/atm. */
  expression: string;
  format: ColumnFormat;
}

export interface ValueResult {
  valueId: string;
  /** The computed scalar. null when the expression errored or evaluated to a
   *  non-finite number. */
  value: number | null;
  error?: string;
}

// ───── Worker protocol ─────

export type WorkerInMessage =
  | { type: 'UPDATE_DATA'; rows: OptionChainRow[] }
  | { type: 'SET_RULES'; rules: RuleDefinition[] }
  | { type: 'SET_COLUMNS'; columns: CustomColumnDefinition[] }
  | { type: 'SET_VALUES'; values: ValueDefinition[] };

export type WorkerOutMessage =
  | {
      type: 'COMPUTE_RESULTS';
      ruleResults: RuleResult[];
      columnResults: ColumnResult[];
      valueResults: ValueResult[];
      computedAt: number;
      durationMs: number;
    }
  | { type: 'COLUMN_ERROR'; columnId: string; error: string };
