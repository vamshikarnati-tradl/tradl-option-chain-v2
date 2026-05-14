// Shared parse + validate hook. Used by both Rule Builder and Column Builder.
// The only kind-specific behavior is whether the root must produce a boolean —
// `requireBoolean: true` (rules) rejects non-boolean roots; `false` (columns)
// accepts any well-formed expression.
//
// Parsing now goes through `parseExpressionLoose` + `resolveColumnRefs` so
// references to saved columns (`maxPain`, `cross_maxPain`) resolve cleanly.
// Pass the live columns list as `availableColumns`. Optionally pass
// `selfColumnId` when editing a column — it's excluded from the resolver so
// the user can't accidentally self-reference (cycle protection).

import { useMemo } from 'react';
import {
  parseExpressionLoose, resolveColumnRefs,
  analyzeDependencies, returnsBoolean, type Expr,
} from '@tradl/shared';
import type { CustomColumnDefinition } from '../../core/types';

export interface ParsedExpression {
  ok: boolean;
  ast?: Expr;
  error?: string;
  errorPos?: number;
  deps?: string[];
  /** Saved-column ids referenced. */
  columnRefs?: string[];
  isTimeAware?: boolean;
  isHistorical?: boolean;
  needsSnapshot?: boolean;
  isBoolean?: boolean;
}

const EMPTY: CustomColumnDefinition[] = [];

export function useExpressionParse(
  expression: string,
  requireBoolean: boolean,
  availableColumns: readonly CustomColumnDefinition[] = EMPTY,
  selfColumnId?: string,
): ParsedExpression {
  return useMemo(() => {
    const src = expression.trim();
    if (!src) return { ok: false };
    const columnsByName = new Map(
      availableColumns
        .filter((c) => c.id !== selfColumnId)
        .map((c) => [c.name, c]),
    );
    try {
      const loose = parseExpressionLoose(src);
      const ast = resolveColumnRefs(loose, columnsByName);
      const deps = analyzeDependencies(ast);
      const isBoolean = returnsBoolean(ast);
      const ok = requireBoolean ? isBoolean : true;
      return {
        ok,
        ast,
        error: !ok
          ? 'Expression must return true/false. Wrap in a comparison (like `call_oi > 80000`) or use a boolean function like `topN(call_oi, 5)`.'
          : undefined,
        deps: deps.fields,
        columnRefs: deps.columnRefs,
        isTimeAware: deps.isTimeAware,
        isHistorical: deps.isHistorical,
        needsSnapshot: deps.needsSnapshot,
        isBoolean,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const match = /at (\d+)/.exec(msg);
      return {
        ok: false,
        error: msg,
        errorPos: match ? Number(match[1]) : undefined,
      };
    }
  }, [expression, requireBoolean, availableColumns, selfColumnId]);
}
