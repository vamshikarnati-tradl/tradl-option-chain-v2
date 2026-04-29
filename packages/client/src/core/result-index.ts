// Inverts the rule/column result lists into per-strike lookups for O(1) read in the table.

import type {
  ColumnCellResult, ColumnResult, CustomColumnDefinition, RuleDefinition, RuleResult,
} from './types';
import { ruleBg } from './palette';

export interface AppliedRule {
  rule: RuleDefinition;
  matchedConditionIndices: number[];
}

export interface RuleHighlight {
  byStrike: Map<number, AppliedRule[]>;
}

export function indexRuleResults(
  results: RuleResult[],
  rulesById: Map<string, RuleDefinition>,
): RuleHighlight {
  const byStrike = new Map<number, AppliedRule[]>();
  for (const r of results) {
    const def = rulesById.get(r.ruleId);
    if (!def) continue;
    for (const m of r.matches) {
      const existing = byStrike.get(m.strikePrice);
      const entry: AppliedRule = { rule: def, matchedConditionIndices: m.matchedConditionIndices };
      if (existing) existing.push(entry);
      else byStrike.set(m.strikePrice, [entry]);
    }
  }
  return { byStrike };
}

export interface AppliedColumn {
  def: CustomColumnDefinition;
  cell: ColumnCellResult;
}

export interface ColumnIndex {
  byStrike: Map<number, AppliedColumn[]>;
  defs: CustomColumnDefinition[];
}

export function indexColumnResults(
  results: ColumnResult[],
  columns: CustomColumnDefinition[],
): ColumnIndex {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const orderedResults: { def: CustomColumnDefinition; res: ColumnResult }[] = [];
  for (const c of columns) {
    const found = results.find((r) => r.columnId === c.id);
    if (found) orderedResults.push({ def: c, res: found });
    else orderedResults.push({ def: c, res: { columnId: c.id, values: [] } });
  }
  const byStrike = new Map<number, AppliedColumn[]>();
  for (const { def, res } of orderedResults) {
    for (const cell of res.values) {
      const list = byStrike.get(cell.strikePrice) ?? [];
      list.push({ def, cell });
      byStrike.set(cell.strikePrice, list);
    }
  }
  return { byStrike, defs: columns.filter((c) => byId.get(c.id)) };
}

// Pick the first matching rule's hue for the given scope. Multi-rule collisions
// resolve to last-applied background, but the hover tooltip enumerates them all.
export function bgForScope(
  applied: AppliedRule[] | undefined,
  scope: 'call' | 'put' | 'row',
): string | null {
  if (!applied?.length) return null;
  const alpha = scope === 'row' ? 0.10 : 0.18;
  let bg: string | null = null;
  for (const a of applied) {
    if (a.rule.style.scope === scope) bg = ruleBg(a.rule.style.hue, alpha);
  }
  return bg;
}
