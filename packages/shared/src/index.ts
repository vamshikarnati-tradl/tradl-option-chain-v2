export type { OptionChainRow, NumericField } from './fields.js';
export { NUMERIC_FIELDS } from './fields.js';

export type { Expr, BinaryOp, BuiltinFn } from './expression-parser.js';
export { parseExpression, extractDependencies } from './expression-parser.js';

export { evaluate, evaluateWithTrace, formatExpr, type EvalTrace } from './expression-evaluator.js';
