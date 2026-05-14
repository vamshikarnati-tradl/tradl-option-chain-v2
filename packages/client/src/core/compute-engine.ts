// The pure compute engine. Lives in either the Web Worker or main thread.
// Two-pass evaluation per tick:
//   1. Compile rules + columns column-aware (resolveColumnRefs uses the
//      live columns list as name-resolution context). Columns get
//      topologically sorted so each one runs after its references.
//   2. computeAll:
//      a. Diff each row's fields against the previous snapshot.
//      b. Compute columns in topo order, building `columnValues` per id.
//         Per-column cell cache reuses values when no UPSTREAM dep changed.
//      c. Compute rules, passing `columnValues` + `compiledColumns` into the
//         evaluator context so `columnRef` nodes resolve correctly and
//         `evaluateWithTrace` can recurse into column bodies for tinting.

import type {
  ColumnCellResult, ColumnResult, CustomColumnDefinition,
  NumericField, OptionChainRow, RuleDefinition, RuleResult,
} from './types';
import {
  parseExpressionLoose, resolveColumnRefs, analyzeDependencies, evaluate,
  type Expr, type EvalContext,
} from '@tradl/shared';
import { compileRule, evaluateCompiledRule, type CompiledRule } from './rule-engine';
import { topoSortColumns, effectiveDeps } from './column-deps';

interface CompiledColumn {
  source: CustomColumnDefinition;
  ast: Expr;
  /** Direct field references inside this column's expression. */
  fieldDeps: NumericField[];
  /** Column ids this column references. */
  columnRefs: string[];
  /** Rolled-up (transitive) deps used for cache invalidation. */
  effective: { fields: NumericField[]; needsSnapshot: boolean; isTimeAware: boolean };
  needsSnapshot: boolean;
  isTimeAware: boolean;
  cellCache: Map<number, ColumnCellResult>;
}

export interface ComputeResult {
  ruleResults: RuleResult[];
  columnResults: ColumnResult[];
  durationMs: number;
  reusedRules: number;
  reusedCells: number;
  totalCells: number;
}

export interface CompileErrors {
  ruleErrors: { ruleId: string; error: string }[];
  columnErrors: { columnId: string; error: string }[];
  /** Cycles detected during column topological sort. Each entry is a
   *  human-readable column-name loop (e.g. `["maxPain → painProxy → maxPain"]`). */
  cycleErrors: string[];
}

export class ComputeEngine {
  private rules: CompiledRule[] = [];
  private columns: CompiledColumn[] = [];
  /** Lookup table for compiled column ASTs by id — supplied to the
   *  evaluator so `evaluateWithTrace` can recurse into column bodies. */
  private columnAstsById = new Map<string, Expr>();
  private prevRows = new Map<number, OptionChainRow>();
  private ruleCache = new Map<string, RuleResult>();
  /** Cached column input definitions so a setRules call alone can re-resolve
   *  rule expressions against the active columns without re-parsing them. */
  private columnDefs: CustomColumnDefinition[] = [];

  setRules(defs: RuleDefinition[]): { errors: { ruleId: string; error: string }[] } {
    const errors: { ruleId: string; error: string }[] = [];
    const compiled: CompiledRule[] = [];
    const columnsByName = new Map(this.columnDefs.map((c) => [c.name, c]));
    for (const def of defs.filter((d) => d.enabled)) {
      try {
        compiled.push(compileRule(def, columnsByName));
      } catch (err) {
        errors.push({ ruleId: def.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.rules = compiled;
    this.ruleCache.clear();
    return { errors };
  }

  setColumns(defs: CustomColumnDefinition[]):
    { errors: { columnId: string; error: string }[]; cycleErrors: string[] } {
    this.columnDefs = defs;
    const errors: { columnId: string; error: string }[] = [];
    const { order, cycles } = topoSortColumns(defs);
    const cycleErrors = cycles.map((c) => c.join(' → '));
    // Compile each column in topological order. The columnsByName map grows
    // as columns are added so a later column can reference an earlier one.
    const columnsByName = new Map(defs.map((c) => [c.name, c]));
    const compiled: CompiledColumn[] = [];
    const asts = new Map<string, Expr>();
    for (const def of order) {
      try {
        const loose = parseExpressionLoose(def.expression);
        const ast = resolveColumnRefs(loose, columnsByName);
        const deps = analyzeDependencies(ast);
        asts.set(def.id, ast);
        const effective = effectiveDeps(ast, asts);
        compiled.push({
          source: def, ast,
          fieldDeps: deps.fields,
          columnRefs: deps.columnRefs,
          effective,
          needsSnapshot: effective.needsSnapshot,
          isTimeAware: effective.isTimeAware,
          cellCache: new Map(),
        });
      } catch (err) {
        errors.push({ columnId: def.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.columns = compiled;
    this.columnAstsById = asts;
    return { errors, cycleErrors };
  }

  computeAll(rows: OptionChainRow[]): ComputeResult {
    const t0 = performance.now();

    // Per-row dependency change set: strike → set of fields that changed since last snapshot.
    // We also track a global "any changed" set per field so the cache layers
    // can short-circuit.
    const perRowChanged = new Map<number, Set<NumericField>>();
    const globallyChanged = new Set<NumericField>();
    for (const row of rows) {
      const prev = this.prevRows.get(row.strikePrice);
      const diff = new Set<NumericField>();
      if (!prev) {
        for (const k of Object.keys(row) as NumericField[]) {
          if (k !== ('expiryDate' as unknown as NumericField)) {
            diff.add(k);
            globallyChanged.add(k);
          }
        }
      } else {
        for (const k of Object.keys(row) as (keyof OptionChainRow)[]) {
          if (k === 'expiryDate') continue;
          if (row[k] !== prev[k]) {
            diff.add(k as NumericField);
            globallyChanged.add(k as NumericField);
          }
        }
      }
      perRowChanged.set(row.strikePrice, diff);
    }

    // ─── First pass: columns in topological order ───
    let reusedCells = 0;
    let totalCells = 0;
    const columnValues = new Map<string, Map<number, number>>();
    const columnCtx: EvalContext = {
      snapshot: rows,
      columnValues,
      compiledColumns: this.columnAstsById,
    };
    const columnResults: ColumnResult[] = this.columns.map((col) => {
      const snapshotDirty = col.needsSnapshot
        && col.effective.fields.some((d) => globallyChanged.has(d));
      const perStrike = new Map<number, number>();
      columnValues.set(col.source.id, perStrike);
      const cells: ColumnCellResult[] = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        totalCells++;
        const row = rows[i];
        const changed = perRowChanged.get(row.strikePrice)!;
        const localIntersects = col.effective.fields.some((d) => changed.has(d));
        const intersects = col.needsSnapshot ? snapshotDirty : localIntersects;
        const cached = col.cellCache.get(row.strikePrice);
        if (cached && !intersects) {
          reusedCells++;
          cells[i] = cached;
          if (cached.value !== null) perStrike.set(row.strikePrice, cached.value);
          continue;
        }
        let cell: ColumnCellResult;
        try {
          const v = evaluate(col.ast, row, columnCtx);
          const finite = Number.isFinite(v);
          cell = {
            strikePrice: row.strikePrice,
            value: finite ? v : null,
            error: finite ? undefined : 'non-finite',
          };
          if (finite) perStrike.set(row.strikePrice, v);
        } catch (err) {
          cell = {
            strikePrice: row.strikePrice,
            value: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        col.cellCache.set(row.strikePrice, cell);
        cells[i] = cell;
      }
      // Drop strikes that no longer exist (chain re-shaped)
      if (col.cellCache.size > rows.length) {
        const keep = new Set(rows.map((r) => r.strikePrice));
        for (const k of col.cellCache.keys()) if (!keep.has(k)) col.cellCache.delete(k);
      }
      return { columnId: col.source.id, values: cells };
    });

    // ─── Second pass: rules (with columnValues available) ───
    let reusedRules = 0;
    const ruleResults: RuleResult[] = this.rules.map((rule) => {
      const ruleEffective = effectiveDeps(rule.ast, this.columnAstsById);
      const cached = this.ruleCache.get(rule.source.id);
      const depChanged = ruleEffective.fields.some((d) => globallyChanged.has(d));
      const needsRecompute = !cached || depChanged || ruleEffective.isTimeAware;
      if (cached && !needsRecompute) {
        reusedRules++;
        return cached;
      }
      const fresh = evaluateCompiledRule(rule, rows, {
        columnValues,
        compiledColumns: this.columnAstsById,
      });
      this.ruleCache.set(rule.source.id, fresh);
      return fresh;
    });

    // Persist current rows as the new "previous" baseline.
    this.prevRows.clear();
    for (const row of rows) this.prevRows.set(row.strikePrice, row);

    return {
      ruleResults,
      columnResults,
      durationMs: performance.now() - t0,
      reusedRules,
      reusedCells,
      totalCells,
    };
  }
}
