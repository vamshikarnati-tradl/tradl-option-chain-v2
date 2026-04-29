import type {
  Condition, ConditionLhs, ConditionRhs, NumericField,
  OptionChainRow, RuleDefinition, RuleResult,
} from './types';
import { extractDependencies, parseExpression, type Expr } from './expression-parser';
import { evaluate } from './expression-evaluator';

interface CompiledCondition {
  source: Condition;
  evalLhs: (row: OptionChainRow) => number;
  // For 'between', returns a tuple; otherwise a single number.
  evalRhs: (row: OptionChainRow) => number | [number, number];
  deps: NumericField[];
}

export interface CompiledRule {
  source: RuleDefinition;
  conditions: CompiledCondition[];
  deps: NumericField[];
}

function compileLhs(lhs: ConditionLhs): { fn: (r: OptionChainRow) => number; deps: NumericField[] } {
  if (lhs.kind === 'field') {
    const f = lhs.field;
    return { fn: (r) => r[f], deps: [f] };
  }
  const ast: Expr = parseExpression(lhs.expression);
  const deps = extractDependencies(ast);
  return { fn: (r) => evaluate(ast, r), deps };
}

function compileRhs(rhs: ConditionRhs): { fn: (r: OptionChainRow) => number | [number, number]; deps: NumericField[] } {
  switch (rhs.kind) {
    case 'literal': {
      const v = rhs.value;
      return { fn: () => v, deps: [] };
    }
    case 'field': {
      const f = rhs.field;
      return { fn: (r) => r[f], deps: [f] };
    }
    case 'expr': {
      const ast = parseExpression(rhs.expression);
      const deps = extractDependencies(ast);
      return { fn: (r) => evaluate(ast, r), deps };
    }
    case 'range': {
      const range = rhs.value;
      return { fn: () => range, deps: [] };
    }
  }
}

export function compileRule(rule: RuleDefinition): CompiledRule {
  const compiled: CompiledCondition[] = [];
  const allDeps = new Set<NumericField>();
  for (const cond of rule.conditions) {
    const lhs = compileLhs(cond.lhs);
    const rhs = compileRhs(cond.rhs);
    for (const d of lhs.deps) allDeps.add(d);
    for (const d of rhs.deps) allDeps.add(d);
    compiled.push({ source: cond, evalLhs: lhs.fn, evalRhs: rhs.fn, deps: [...new Set([...lhs.deps, ...rhs.deps])] });
  }
  return { source: rule, conditions: compiled, deps: [...allDeps] };
}

function checkCondition(c: CompiledCondition, row: OptionChainRow): boolean {
  const lhs = c.evalLhs(row);
  const rhs = c.evalRhs(row);
  switch (c.source.operator) {
    case 'gt': return lhs > (rhs as number);
    case 'gte': return lhs >= (rhs as number);
    case 'lt': return lhs < (rhs as number);
    case 'lte': return lhs <= (rhs as number);
    case 'eq': return lhs === (rhs as number);
    case 'neq': return lhs !== (rhs as number);
    case 'between': {
      const [lo, hi] = rhs as [number, number];
      return lhs >= lo && lhs <= hi;
    }
  }
}

export function evaluateCompiledRule(rule: CompiledRule, rows: OptionChainRow[]): RuleResult {
  const matches: RuleResult['matches'] = [];
  const conds = rule.conditions;
  const isAnd = rule.source.logic === 'AND';
  for (const row of rows) {
    const matched: number[] = [];
    for (let i = 0; i < conds.length; i++) {
      if (checkCondition(conds[i], row)) matched.push(i);
    }
    const ok = isAnd ? matched.length === conds.length : matched.length > 0;
    if (ok) matches.push({ strikePrice: row.strikePrice, matchedConditionIndices: matched });
  }
  return { ruleId: rule.source.id, matches };
}
