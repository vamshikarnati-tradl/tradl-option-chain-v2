// Shared parse helper for any UI surface that renders a stored expression —
// rule cards, hover tooltips, AI preview, column cards. The stored
// expression may contain column references (`maxPain`, `strike_maxPain`)
// that the strict `parseExpression` rejects as unknown identifiers.
//
// This helper does loose parse → resolve in one call, preserving the
// original char position when an identifier truly is unknown (typo or a
// stale reference to a deleted column).

import { parseExpressionLoose, resolveColumnRefs, type Expr } from '@tradl/shared';
import type { CustomColumnDefinition } from './types';

export function parseAndResolve(
  src: string,
  columns: readonly CustomColumnDefinition[] = [],
): Expr {
  const byName = new Map(columns.map((c) => [c.name, c] as const));
  return resolveColumnRefs(parseExpressionLoose(src), byName);
}
