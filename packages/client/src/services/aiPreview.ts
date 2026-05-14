// Helpers for showing a dry-run preview of an AI-parsed rule or column
// against the current chain — runs on the main thread (not the worker)
// because the parsed rule isn't committed yet.

import { compileRule, evaluateCompiledRule } from '../core/rule-engine';
import { extractDependencies } from '../core/expression-parser';
import { evaluate } from '../core/expression-evaluator';
import { parseAndResolve } from '../core/parse-and-resolve';
import type { CustomColumnDefinition, OptionChainRow, RuleDefinition } from '../core/types';
import { parseExpressionLoose, resolveColumnRefs, type Expr } from '@tradl/shared';

export interface DryRunRule {
  matches: number;
  total: number;
  error?: string;
}

const EMPTY_COLUMNS_BY_NAME = new Map<string, CustomColumnDefinition>();

export function dryRunRule(
  rule: RuleDefinition,
  rows: OptionChainRow[],
  columns: CustomColumnDefinition[] = [],
): DryRunRule {
  if (!rows.length) return { matches: 0, total: 0 };
  try {
    const columnsByName = columns.length
      ? new Map(columns.map((c) => [c.name, c]))
      : EMPTY_COLUMNS_BY_NAME;
    const compiled = compileRule(rule, columnsByName);
    const result = evaluateCompiledRule(compiled, rows);
    return { matches: result.matches.length, total: rows.length };
  } catch (err) {
    return { matches: 0, total: rows.length, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ColumnSample {
  strikePrice: number;
  value: number | null;
  isAtm?: boolean;
  error?: string;
}

// Returns up to 3 sample evaluations: one strike below ATM, ATM, one above.
// Accepts optional `columns` so the expression can reference saved columns
// (e.g. `maxPainLevel * 100`). Each referenced column's compiled AST is
// passed via the eval context so the evaluator's live-eval fallback can
// resolve it recursively without precomputed values.
export function dryRunColumn(
  expression: string,
  rows: OptionChainRow[],
  columns: CustomColumnDefinition[] = [],
): ColumnSample[] {
  if (!rows.length) return [];
  let ast;
  try {
    ast = parseAndResolve(expression, columns);
    extractDependencies(ast);
  } catch (err) {
    return [{
      strikePrice: rows[0].strikePrice,
      value: null,
      error: err instanceof Error ? err.message : String(err),
    }];
  }

  // Pre-resolve every column so the evaluator's columnRef fallback can
  // walk them recursively. Broken columns are skipped — their downstream
  // references will resolve to NaN.
  const compiledColumns = new Map<string, Expr>();
  const byName = new Map(columns.map((c) => [c.name, c]));
  for (const col of columns) {
    try {
      compiledColumns.set(col.id, resolveColumnRefs(parseExpressionLoose(col.expression), byName));
    } catch { /* skip */ }
  }

  const spot = rows[0].underlyingValue;
  let atmIdx = 0;
  let atmDist = Math.abs(rows[0].strikePrice - spot);
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(rows[i].strikePrice - spot);
    if (d < atmDist) { atmDist = d; atmIdx = i; }
  }

  const indices = [Math.max(0, atmIdx - 1), atmIdx, Math.min(rows.length - 1, atmIdx + 1)]
    .filter((v, i, arr) => arr.indexOf(v) === i);

  return indices.map((i): ColumnSample => {
    const row = rows[i];
    try {
      const v = evaluate(ast!, row, { snapshot: rows, compiledColumns });
      return {
        strikePrice: row.strikePrice,
        value: Number.isFinite(v) ? v : null,
        isAtm: i === atmIdx,
        error: Number.isFinite(v) ? undefined : 'non-finite',
      };
    } catch (err) {
      return {
        strikePrice: row.strikePrice,
        value: null,
        isAtm: i === atmIdx,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
