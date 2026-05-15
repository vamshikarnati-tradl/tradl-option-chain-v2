export type { OptionChainRow, NumericField } from './fields.js';
export { NUMERIC_FIELDS } from './fields.js';

export type {
  Expr, BinaryOp, BuiltinFn, NodeRange,
  AstDependencies, IntradayDep, HistoricalDep,
} from './expression-parser.js';
export {
  parseExpression, parseExpressionLoose, resolveColumnRefs,
  extractDependencies, analyzeDependencies, returnsBoolean,
  CROSS_FIELD_PREFIX,
} from './expression-parser.js';

export {
  evaluate, evaluateWithTrace, formatExpr, formatExprMultiline,
  type EvalTrace, type EvalContext,
} from './expression-evaluator.js';

export {
  FUNCTION_CATALOG, FIELD_CATALOG, CATEGORY_CATALOG, SUBGROUP_CATALOG,
  COMPARATORS, COMPARATOR_LABELS,
  CLIENT_DURATIONS, BACKEND_DURATIONS, ALL_DURATIONS,
  HISTORICAL_AGGS,
  getFunction, knownFunctionNames, arityOf, isLive,
  durationToMs, isClientDuration, isBackendDuration,
  type FunctionSpec, type ArgSpec, type ArgKind,
  type Category, type Status, type ReturnKind,
  type CategorySpec, type FieldSpec, type SubgroupSpec,
  type Comparator,
  type DurationLiteral, type HistoricalAgg,
} from './function-catalog.js';
