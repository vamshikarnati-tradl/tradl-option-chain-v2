// Server-side validator for LLM-parsed rules/columns. Runs *before* the
// response is returned to the client so a malformed draft never reaches the
// engine. Uses the shared parser/evaluator — same code that runs in the worker
// — so what we accept here is what will actually execute.

import {
  NUMERIC_FIELDS, evaluate, extractDependencies, parseExpression, returnsBoolean,
  type NumericField, type OptionChainRow,
} from '@tradl/shared';

const ALLOWED = new Set<string>(NUMERIC_FIELDS);

export interface ValidationFailure {
  ok: false;
  // Short user-facing summary ("Unknown field 'call_OI'").
  error: string;
  // Longer detail handed to the LLM in the repair retry.
  detail: string;
}

export interface ValidationSuccess {
  ok: true;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

function fail(error: string, detail = error): ValidationFailure {
  return { ok: false, error, detail };
}

function validateField(name: string, where: string): ValidationFailure | null {
  if (!ALLOWED.has(name)) {
    return fail(
      `Unknown field "${name}" in ${where}`,
      `The field "${name}" is not in the allowed list. Use one of: ${NUMERIC_FIELDS.join(', ')}.`,
    );
  }
  return null;
}

function validateExpression(expr: string, where: string, sampleRow: OptionChainRow | null): ValidationFailure | null {
  let ast;
  try {
    ast = parseExpression(expr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Syntax error in ${where}: ${msg}`, `Failed to parse "${expr}" in ${where}: ${msg}`);
  }
  const deps = extractDependencies(ast);
  for (const d of deps) {
    const f = validateField(d as string, `${where} (expression "${expr}")`);
    if (f) return f;
  }
  if (sampleRow) {
    try {
      const v = evaluate(ast, sampleRow);
      if (!Number.isFinite(v)) {
        return fail(
          `Expression produced ${v} on sample row in ${where}`,
          `Expression "${expr}" evaluated to ${v} (NaN/Infinity) for ATM row. Likely division by zero or invalid math.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Runtime error in ${where}: ${msg}`, `Evaluating "${expr}" threw: ${msg}`);
    }
  }
  return null;
}

interface ParsedColumn {
  expression: string;
  format: { decimals: number };
}

interface ParsedConditionSide {
  kind: 'field' | 'expr' | 'literal';
  field?: string;
  expression?: string;
}

interface ParsedRule {
  conditions: Array<{
    lhs: ParsedConditionSide;
    rhs: ParsedConditionSide;
  }>;
}

export function validateColumn(c: ParsedColumn, sample: OptionChainRow | null): ValidationResult {
  if (!c.expression?.trim()) return fail('Column expression is empty', 'The column needs a non-empty expression.');
  const fail1 = validateExpression(c.expression, 'column expression', sample);
  if (fail1) return fail1;
  return { ok: true };
}

export function validateRule(r: ParsedRule, sample: OptionChainRow | null): ValidationResult {
  if (!r.conditions?.length) return fail('Rule has no conditions', 'The rule must have at least one condition.');
  for (let i = 0; i < r.conditions.length; i++) {
    const c = r.conditions[i];
    const where = `condition ${i + 1}`;
    const lhsFail = validateSide(c.lhs, `${where} LHS`, sample);
    if (lhsFail) return lhsFail;
    const rhsFail = validateSide(c.rhs, `${where} RHS`, sample);
    if (rhsFail) return rhsFail;
  }
  return { ok: true };
}

function validateSide(side: ParsedConditionSide, where: string, sample: OptionChainRow | null): ValidationFailure | null {
  if (side.kind === 'field') {
    if (!side.field) return fail(`${where} is missing a field name`, `${where} kind="field" but field is empty.`);
    return validateField(side.field, where);
  }
  if (side.kind === 'expr') {
    if (!side.expression) return fail(`${where} is missing an expression`, `${where} kind="expr" but expression is empty.`);
    return validateExpression(side.expression, where, sample);
  }
  return null;
}

// Convenience type guard for the field allowlist (avoids `string` widening at
// call sites that need NumericField).
export function isNumericField(name: string): name is NumericField {
  return ALLOWED.has(name);
}

/**
 * Validate a single-expression rule (new shape). Parses, checks fields,
 * requires a boolean root, and dry-runs against the sample row if provided.
 */
export function validateBooleanExpression(
  expr: string, sampleRow: OptionChainRow | null,
): ValidationResult {
  if (!expr?.trim()) return fail('Expression is empty', 'The rule needs a non-empty expression.');
  let ast;
  try {
    ast = parseExpression(expr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Syntax error: ${msg}`, `Failed to parse "${expr}": ${msg}`);
  }
  const deps = extractDependencies(ast);
  for (const d of deps) {
    const f = validateField(d as string, 'rule expression');
    if (f) return f;
  }
  if (!returnsBoolean(ast)) {
    return fail(
      'Rule must return true or false',
      `The expression "${expr}" does not produce a boolean. Wrap it in a comparison (like "call_oi > 80000") or use a boolean function like "topN(call_oi, 5)".`,
    );
  }
  if (sampleRow) {
    try {
      const v = evaluate(ast, sampleRow, { snapshot: [sampleRow] });
      if (!Number.isFinite(v)) {
        return fail(
          `Expression produced ${v} on sample row`,
          `Expression "${expr}" evaluated to ${v} (NaN/Infinity) for ATM row. Likely division by zero or invalid math.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Runtime error: ${msg}`, `Evaluating "${expr}" threw: ${msg}`);
    }
  }
  return { ok: true };
}

/**
 * Validate a single-expression column. Same as the boolean validator minus
 * the boolean-root requirement — columns produce numeric values for display.
 */
export function validateNumericExpression(
  expr: string, sampleRow: OptionChainRow | null,
): ValidationResult {
  if (!expr?.trim()) return fail('Expression is empty', 'The column needs a non-empty expression.');
  let ast;
  try {
    ast = parseExpression(expr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Syntax error: ${msg}`, `Failed to parse "${expr}": ${msg}`);
  }
  const deps = extractDependencies(ast);
  for (const d of deps) {
    const f = validateField(d as string, 'column expression');
    if (f) return f;
  }
  if (sampleRow) {
    try {
      const v = evaluate(ast, sampleRow, { snapshot: [sampleRow] });
      if (!Number.isFinite(v)) {
        return fail(
          `Expression produced ${v} on sample row`,
          `Expression "${expr}" evaluated to ${v} (NaN/Infinity) for ATM row. Likely division by zero or invalid math.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Runtime error: ${msg}`, `Evaluating "${expr}" threw: ${msg}`);
    }
  }
  return { ok: true };
}
