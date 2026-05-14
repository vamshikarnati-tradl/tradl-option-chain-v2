// Column dependency graph utilities.
//
//   - topoSortColumns: orders columns so each compiles after its references.
//     Detects cycles and reports the offending loop for clear error messages.
//
//   - findDependents: given a column id, walks every rule + column expression
//     and reports the ones that reference it. Drives the cascade-delete
//     confirmation modal.
//
//   - effectiveDeps: rolls up a rule/column's transitive field + snapshot +
//     time-aware flags through its column references. Used by the compute
//     engine's cache invalidation logic so a rule that uses `maxPain`
//     invalidates when any of maxPain's underlying fields changes.
//
// Parsing happens via `parseExpressionLoose` so unknown identifiers don't
// throw — they may legitimately be column refs we haven't resolved yet, or
// just authoring errors we want to handle gracefully (skip + continue).

import {
  parseExpressionLoose, resolveColumnRefs, analyzeDependencies,
  type Expr, type NumericField,
} from '@tradl/shared';
import type { CustomColumnDefinition, RuleDefinition } from './types';

export interface ColumnTopoResult {
  /** Columns in dependency-safe evaluation order. Independents first; each
   *  column appears after every column it references. */
  order: CustomColumnDefinition[];
  /** Strongly-connected cycles. Each entry is a column-id loop in trace
   *  order, e.g. `['maxPain', 'painProxy', 'maxPain']`. */
  cycles: string[][];
}

interface ColumnAnalysis {
  fields: Set<NumericField>;
  columnRefs: Set<string>;
  needsSnapshot: boolean;
  isTimeAware: boolean;
  isHistorical: boolean;
}

/** Parse + resolve a single expression. Returns null if parsing or resolution
 *  fails — the caller treats that as "no extractable deps" rather than
 *  surfacing the error here (the rule/column engine reports compile errors
 *  through its own channel). */
function analyzeColumn(
  expression: string,
  columnsByName: ReadonlyMap<string, CustomColumnDefinition>,
): ColumnAnalysis | null {
  try {
    const loose = parseExpressionLoose(expression);
    const resolved = resolveColumnRefs(loose, columnsByName);
    const deps = analyzeDependencies(resolved);
    return {
      fields: new Set(deps.fields),
      columnRefs: new Set(deps.columnRefs),
      needsSnapshot: deps.needsSnapshot,
      isTimeAware: deps.isTimeAware,
      isHistorical: deps.isHistorical,
    };
  } catch {
    return null;
  }
}

export function topoSortColumns(columns: CustomColumnDefinition[]): ColumnTopoResult {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const byId = new Map(columns.map((c) => [c.id, c]));

  // Build adjacency: for each column, which other column ids does it depend on?
  const deps = new Map<string, Set<string>>();
  for (const col of columns) {
    const analysis = analyzeColumn(col.expression, byName);
    deps.set(col.id, analysis?.columnRefs ?? new Set());
  }

  // Kahn's algorithm with cycle detection.
  const remaining = new Set(columns.map((c) => c.id));
  const order: CustomColumnDefinition[] = [];
  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const id of remaining) {
      const ds = deps.get(id)!;
      const blocked = [...ds].some((d) => remaining.has(d));
      if (!blocked) ready.push(id);
    }
    if (ready.length === 0) break; // all remaining are tangled in cycles
    for (const id of ready) {
      remaining.delete(id);
      const c = byId.get(id);
      if (c) order.push(c);
    }
  }

  // If anything's left, those form one or more cycles. Trace them.
  const cycles: string[][] = [];
  if (remaining.size > 0) {
    const seen = new Set<string>();
    for (const start of remaining) {
      if (seen.has(start)) continue;
      const cycle = traceCycle(start, deps, remaining);
      if (cycle) {
        for (const id of cycle) seen.add(id);
        cycles.push(cycle.map((id) => byId.get(id)?.name ?? id));
      }
    }
    // Append the unresolved columns to the order at the end so the engine
    // can still try to compile them (will surface a cycle error per col).
    for (const id of remaining) {
      const c = byId.get(id);
      if (c) order.push(c);
    }
  }

  return { order, cycles };
}

function traceCycle(
  start: string,
  deps: ReadonlyMap<string, ReadonlySet<string>>,
  inSet: ReadonlySet<string>,
): string[] | null {
  const path: string[] = [];
  const onPath = new Set<string>();
  const dfs = (node: string): string[] | null => {
    if (onPath.has(node)) {
      // Found cycle: slice from first occurrence of `node` in the path.
      const idx = path.indexOf(node);
      return [...path.slice(idx), node];
    }
    path.push(node);
    onPath.add(node);
    for (const next of deps.get(node) ?? new Set<string>()) {
      if (!inSet.has(next)) continue;
      const found = dfs(next);
      if (found) return found;
    }
    path.pop();
    onPath.delete(node);
    return null;
  };
  return dfs(start);
}

export interface DependentList {
  rules: RuleDefinition[];
  columns: CustomColumnDefinition[];
}

/** Find every rule + column whose expression references the given column id. */
export function findDependents(
  targetId: string,
  rules: RuleDefinition[],
  columns: CustomColumnDefinition[],
): DependentList {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const dependentRules: RuleDefinition[] = [];
  const dependentColumns: CustomColumnDefinition[] = [];
  for (const r of rules) {
    const a = analyzeColumn(r.expression, byName);
    if (a && a.columnRefs.has(targetId)) dependentRules.push(r);
  }
  for (const c of columns) {
    if (c.id === targetId) continue;
    const a = analyzeColumn(c.expression, byName);
    if (a && a.columnRefs.has(targetId)) dependentColumns.push(c);
  }
  return { rules: dependentRules, columns: dependentColumns };
}

/** Roll up a compiled entity's transitive deps through column references.
 *  Used by the compute-engine cache so a rule that reads `maxPain` is
 *  invalidated when ANY of maxPain's underlying fields changes globally. */
export interface EffectiveDeps {
  fields: NumericField[];
  needsSnapshot: boolean;
  isTimeAware: boolean;
}

export function effectiveDeps(
  rootAst: Expr,
  columnAstsById: ReadonlyMap<string, Expr>,
): EffectiveDeps {
  const fields = new Set<NumericField>();
  const visited = new Set<string>();
  let needsSnapshot = false;
  let isTimeAware = false;

  const merge = (ast: Expr): void => {
    const deps = analyzeDependencies(ast);
    for (const f of deps.fields) fields.add(f);
    if (deps.needsSnapshot) needsSnapshot = true;
    if (deps.isTimeAware) isTimeAware = true;
    for (const id of deps.columnRefs) {
      if (visited.has(id)) continue;
      visited.add(id);
      const sub = columnAstsById.get(id);
      if (sub) merge(sub);
    }
  };
  merge(rootAst);
  return { fields: [...fields], needsSnapshot, isTimeAware };
}
