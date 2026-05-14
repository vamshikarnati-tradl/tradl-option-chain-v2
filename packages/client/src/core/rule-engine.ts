// Compile + evaluate rules. A rule is a single expression whose AST root
// must produce true/false. Compilation now happens in two passes:
// `parseExpressionLoose` defers unknown-identifier errors, and
// `resolveColumnRefs` rewrites them into `columnRef` / `crossColumnRef`
// nodes when a saved column matches. The engine walks rows through
// `evaluateWithTrace` so `affectedFields` reflects the cells actually read
// on each row (including reads inside any referenced column body).

import type {
  CustomColumnDefinition, NumericField, OptionChainRow,
  RuleDefinition, RuleResult,
} from './types';
import {
  parseExpressionLoose, resolveColumnRefs, analyzeDependencies, returnsBoolean,
  evaluateWithTrace, type Expr, type EvalContext,
} from '@tradl/shared';

export interface CompiledRule {
  source: RuleDefinition;
  ast: Expr;
  /** Fields referenced anywhere in the expression — used by the engine's
   *  global change-tracking cache. NOTE: this is the rule's DIRECT field
   *  references. Effective deps (including fields reached via column
   *  references) get rolled up by `effectiveDeps` in `column-deps.ts`. */
  deps: NumericField[];
  /** Saved-column ids the rule reads. Compute engine rolls up the
   *  transitive field deps from these for cache invalidation. */
  columnRefs: string[];
  needsSnapshot: boolean;
  isTimeAware: boolean;
  isHistorical: boolean;
}

export function compileRule(
  def: RuleDefinition,
  columnsByName: ReadonlyMap<string, CustomColumnDefinition>,
): CompiledRule {
  const loose = parseExpressionLoose(def.expression);
  const ast = resolveColumnRefs(loose, columnsByName);
  if (!returnsBoolean(ast)) {
    throw new Error(
      `Rule "${def.name}" must produce true/false. Wrap the expression in a comparison (like \`call_oi > 80000\`) or use a boolean function like \`topN(call_oi, 5)\`.`,
    );
  }
  const deps = analyzeDependencies(ast);
  return {
    source: def,
    ast,
    deps: deps.fields,
    columnRefs: deps.columnRefs,
    needsSnapshot: deps.needsSnapshot,
    isTimeAware: deps.isTimeAware,
    isHistorical: deps.isHistorical,
  };
}

export function evaluateCompiledRule(
  rule: CompiledRule,
  rows: readonly OptionChainRow[],
  ctxExtras: Pick<EvalContext, 'columnValues' | 'compiledColumns'> = {},
): RuleResult {
  const matches: RuleResult['matches'] = [];
  const ctx: EvalContext = { snapshot: rows, ...ctxExtras };
  for (const row of rows) {
    let trace;
    try {
      trace = evaluateWithTrace(rule.ast, row, ctx);
    } catch {
      // Per-row eval failure (e.g. division by zero) — treat as no match.
      continue;
    }
    if (!Number.isFinite(trace.value) || trace.value === 0) continue;
    matches.push({
      strikePrice: row.strikePrice,
      affectedFields: trace.fieldValues.map((fv) => fv.field),
      affectedColumns: trace.columnValues.map((cv) => cv.columnId),
    });
  }
  return { ruleId: rule.source.id, matches };
}
