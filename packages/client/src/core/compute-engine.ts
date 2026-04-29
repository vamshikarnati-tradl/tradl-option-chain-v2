// The pure compute engine. Lives in either the Web Worker or main thread.
// Tracks dependencies and memoizes per-rule / per-cell so unchanged inputs
// don't trigger re-evaluation.

import type {
  ColumnCellResult, ColumnResult, CustomColumnDefinition,
  NumericField, OptionChainRow, RuleDefinition, RuleResult,
} from './types';
import { extractDependencies, parseExpression, type Expr } from './expression-parser';
import { evaluate } from './expression-evaluator';
import { compileRule, evaluateCompiledRule, type CompiledRule } from './rule-engine';

interface CompiledColumn {
  source: CustomColumnDefinition;
  ast: Expr;
  deps: NumericField[];
  // strike → cached cell result (re-used when none of deps changed for that row)
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

export class ComputeEngine {
  private rules: CompiledRule[] = [];
  private columns: CompiledColumn[] = [];
  private prevRows = new Map<number, OptionChainRow>();
  private ruleCache = new Map<string, RuleResult>();

  setRules(defs: RuleDefinition[]): { errors: { ruleId: string; error: string }[] } {
    const errors: { ruleId: string; error: string }[] = [];
    const compiled: CompiledRule[] = [];
    for (const def of defs.filter((d) => d.enabled)) {
      try {
        compiled.push(compileRule(def));
      } catch (err) {
        errors.push({ ruleId: def.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.rules = compiled;
    this.ruleCache.clear();
    return { errors };
  }

  setColumns(defs: CustomColumnDefinition[]): { errors: { columnId: string; error: string }[] } {
    const errors: { columnId: string; error: string }[] = [];
    const compiled: CompiledColumn[] = [];
    for (const def of defs) {
      try {
        const ast = parseExpression(def.expression);
        const deps = extractDependencies(ast);
        compiled.push({ source: def, ast, deps, cellCache: new Map() });
      } catch (err) {
        errors.push({ columnId: def.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.columns = compiled;
    return { errors };
  }

  computeAll(rows: OptionChainRow[]): ComputeResult {
    const t0 = performance.now();

    // Per-row dependency change set: strike → set of fields that changed since last snapshot.
    // We also track a global "any changed" set per field so rule cache can short-circuit.
    const perRowChanged = new Map<number, Set<NumericField>>();
    const globallyChanged = new Set<NumericField>();
    for (const row of rows) {
      const prev = this.prevRows.get(row.strikePrice);
      const diff = new Set<NumericField>();
      if (!prev) {
        // brand-new row → all fields counted as changed
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

    // Rules: re-evaluate iff any dependency field changed anywhere.
    let reusedRules = 0;
    const ruleResults: RuleResult[] = this.rules.map((rule) => {
      const cached = this.ruleCache.get(rule.source.id);
      const needsRecompute = !cached || rule.deps.some((d) => globallyChanged.has(d));
      if (cached && !needsRecompute) {
        reusedRules++;
        return cached;
      }
      const fresh = evaluateCompiledRule(rule, rows);
      this.ruleCache.set(rule.source.id, fresh);
      return fresh;
    });

    // Columns: per-cell memo. If a row's changed-fields don't intersect the column's deps,
    // reuse the previous cell value.
    let reusedCells = 0;
    let totalCells = 0;
    const columnResults: ColumnResult[] = this.columns.map((col) => {
      const cells: ColumnCellResult[] = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        totalCells++;
        const row = rows[i];
        const changed = perRowChanged.get(row.strikePrice)!;
        const intersects = col.deps.some((d) => changed.has(d));
        const cached = col.cellCache.get(row.strikePrice);
        if (cached && !intersects) {
          reusedCells++;
          cells[i] = cached;
          continue;
        }
        let cell: ColumnCellResult;
        try {
          const v = evaluate(col.ast, row);
          cell = {
            strikePrice: row.strikePrice,
            value: Number.isFinite(v) ? v : null,
            error: Number.isFinite(v) ? undefined : 'non-finite',
          };
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
