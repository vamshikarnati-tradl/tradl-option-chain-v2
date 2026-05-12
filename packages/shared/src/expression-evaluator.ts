import type { Expr, BuiltinFn, BinaryOp } from './expression-parser.js';
import type { NumericField, OptionChainRow } from './fields.js';

const CONSTS = { PI: Math.PI, E: Math.E } as const;

const BUILTINS: Record<BuiltinFn, (...args: number[]) => number> = {
  abs: Math.abs,
  max: Math.max,
  min: Math.min,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  pow: Math.pow,
  log: Math.log,
  exp: Math.exp,
};

export function evaluate(expr: Expr, row: OptionChainRow): number {
  switch (expr.kind) {
    case 'num': return expr.value;
    case 'const': return CONSTS[expr.name];
    case 'field': return row[expr.name];
    case 'unary': {
      const v = evaluate(expr.arg, row);
      switch (expr.op) {
        case '-': return -v;
        case '+': return +v;
        case '!': return v ? 0 : 1;
      }
      break;
    }
    case 'binary': {
      const l = evaluate(expr.left, row);
      if (expr.op === '&&') return l ? (evaluate(expr.right, row) ? 1 : 0) : 0;
      if (expr.op === '||') return l ? 1 : (evaluate(expr.right, row) ? 1 : 0);
      const r = evaluate(expr.right, row);
      switch (expr.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? NaN : l / r;
        case '%': return r === 0 ? NaN : l % r;
        case '>': return l > r ? 1 : 0;
        case '<': return l < r ? 1 : 0;
        case '>=': return l >= r ? 1 : 0;
        case '<=': return l <= r ? 1 : 0;
        case '==': return l === r ? 1 : 0;
        case '!=': return l !== r ? 1 : 0;
      }
      break;
    }
    case 'ternary': {
      const c = evaluate(expr.cond, row);
      return c ? evaluate(expr.whenTrue, row) : evaluate(expr.whenFalse, row);
    }
    case 'call': {
      const args = expr.args.map((a) => evaluate(a, row));
      return BUILTINS[expr.name](...args);
    }
  }
  throw new Error('Unhandled expression node');
}

// Reconstruct a readable source string from an AST. Used by hover tooltips to
// display the formula without depending on the user's original input string —
// helpful for ASTs assembled programmatically (e.g. condition LHS/RHS).
const BINOP_PREC: Record<BinaryOp, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '>': 4, '<': 4, '>=': 4, '<=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

export function formatExpr(expr: Expr, parentPrec = 0): string {
  switch (expr.kind) {
    case 'num': return String(expr.value);
    case 'const': return expr.name;
    case 'field': return expr.name;
    case 'unary': return `${expr.op}${formatExpr(expr.arg, 7)}`;
    case 'binary': {
      const prec = BINOP_PREC[expr.op];
      const s = `${formatExpr(expr.left, prec)} ${expr.op} ${formatExpr(expr.right, prec + 1)}`;
      return prec < parentPrec ? `(${s})` : s;
    }
    case 'ternary':
      return `${formatExpr(expr.cond, 0)} ? ${formatExpr(expr.whenTrue, 0)} : ${formatExpr(expr.whenFalse, 0)}`;
    case 'call':
      return `${expr.name}(${expr.args.map((a) => formatExpr(a, 0)).join(', ')})`;
  }
}

export interface EvalTrace {
  value: number;
  // Live values for every numeric field referenced. De-duplicated; order matches
  // first appearance in the AST.
  fieldValues: Array<{ field: NumericField; value: number }>;
}

export function evaluateWithTrace(expr: Expr, row: OptionChainRow): EvalTrace {
  const seen = new Set<NumericField>();
  const fieldValues: EvalTrace['fieldValues'] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case 'field':
        if (!seen.has(e.name)) {
          seen.add(e.name);
          fieldValues.push({ field: e.name, value: row[e.name] });
        }
        return;
      case 'unary': walk(e.arg); return;
      case 'binary': walk(e.left); walk(e.right); return;
      case 'ternary': walk(e.cond); walk(e.whenTrue); walk(e.whenFalse); return;
      case 'call': for (const a of e.args) walk(a); return;
      case 'num': case 'const': return;
    }
  };
  walk(expr);
  return { value: evaluate(expr, row), fieldValues };
}
