import type { Expr, BuiltinFn } from './expression-parser';
import type { OptionChainRow } from './types';

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
      // Short-circuit logical ops
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
  // Should be unreachable
  throw new Error('Unhandled expression node');
}
