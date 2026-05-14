// Build a `compiledColumns` map for the live-eval fallback path in the
// evaluator. Used by builder previews (RuleBuilder / ColumnBuilder) — they
// don't have access to the engine's per-snapshot columnValues table, so
// the evaluator needs the compiled column ASTs to live-evaluate column
// references via recursion.
//
// Broken columns (parse or resolve fails) are skipped silently — the
// builder UIs report compile errors through their own channels and we
// don't want a single bad column to crash the preview for others.

import { useMemo } from 'react';
import {
  parseExpressionLoose, resolveColumnRefs, type Expr,
} from '@tradl/shared';
import type { CustomColumnDefinition } from '../../core/types';

export function useCompiledColumns(
  columns: readonly CustomColumnDefinition[] | undefined,
  excludeId?: string,
): ReadonlyMap<string, Expr> | undefined {
  return useMemo(() => {
    if (!columns || columns.length === 0) return undefined;
    const eligible = columns.filter((c) => c.id !== excludeId);
    const byName = new Map(eligible.map((c) => [c.name, c]));
    const out = new Map<string, Expr>();
    for (const col of eligible) {
      try {
        const loose = parseExpressionLoose(col.expression);
        const ast = resolveColumnRefs(loose, byName);
        out.set(col.id, ast);
      } catch {
        // Skip — broken column. Resolution failures here just mean any
        // dependent expression will see NaN; the builder error states
        // elsewhere will report the issue.
      }
    }
    return out;
  }, [columns, excludeId]);
}
