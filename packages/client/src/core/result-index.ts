// Inverts the rule/column result lists into per-strike + per-cell lookups for
// O(1) read in the table. Cell-level tinting comes from `byCell`: every (strike,
// field) → list of rules that named `field` in their dependencies AND matched
// that strike.

import type {
  ColumnCellResult, ColumnResult, CustomColumnDefinition, NumericField,
  RuleDefinition, RuleResult,
} from './types';
import { ruleBg, ruleHsl } from './palette';

export interface AppliedRule {
  rule: RuleDefinition;
  matchedConditionIndices: number[];
  affectedFields: NumericField[];
}

export interface RuleHighlight {
  byStrike: Map<number, AppliedRule[]>;
  byCell: Map<number, Map<NumericField, AppliedRule[]>>;
}

export function indexRuleResults(
  results: RuleResult[],
  rulesById: Map<string, RuleDefinition>,
): RuleHighlight {
  const byStrike = new Map<number, AppliedRule[]>();
  const byCell = new Map<number, Map<NumericField, AppliedRule[]>>();
  for (const r of results) {
    const def = rulesById.get(r.ruleId);
    if (!def) continue;
    for (const m of r.matches) {
      const entry: AppliedRule = {
        rule: def,
        matchedConditionIndices: m.matchedConditionIndices,
        affectedFields: m.affectedFields,
      };
      const sList = byStrike.get(m.strikePrice);
      if (sList) sList.push(entry); else byStrike.set(m.strikePrice, [entry]);

      let cellMap = byCell.get(m.strikePrice);
      if (!cellMap) { cellMap = new Map(); byCell.set(m.strikePrice, cellMap); }
      for (const f of m.affectedFields) {
        const list = cellMap.get(f);
        if (list) list.push(entry); else cellMap.set(f, [entry]);
      }
    }
  }
  return { byStrike, byCell };
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

export interface CellStyle {
  background?: string;
  boxShadow?: string;
}

// Compose a cell background from a set of rules that tinted it.
// Dominant rule (first in list) fills the cell; additional rules render as
// stacked 2px inset rings. Caps additional rings at 3 to avoid visual chaos —
// the strike-cell RuleChipStrip remains the canonical "all rules on this row"
// indicator for higher collision counts.
export function bgForCell(rules: AppliedRule[] | undefined): CellStyle {
  if (!rules?.length) return {};
  const [dominant, ...rest] = rules;
  const background = ruleBg(dominant.rule.style.hue, 0.18);
  if (!rest.length) return { background };
  const rings = rest.slice(0, 3).map((r, i) =>
    `inset 0 0 0 ${2 + i * 2}px ${ruleHsl(r.rule.style.hue, 0.75)}`,
  );
  return { background, boxShadow: rings.join(', ') };
}

// Aggregate rules across multiple fields the cell visually represents (e.g. the
// Call OI cell shows both `call_oi` and `call_oiChange`). De-duplicates rules
// while preserving the order of their first appearance.
export function rulesForCell(
  cellMap: Map<NumericField, AppliedRule[]> | undefined,
  fields: readonly NumericField[],
): AppliedRule[] | undefined {
  if (!cellMap) return undefined;
  const out: AppliedRule[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const list = cellMap.get(f);
    if (!list) continue;
    for (const a of list) {
      if (seen.has(a.rule.id)) continue;
      seen.add(a.rule.id);
      out.push(a);
    }
  }
  return out.length ? out : undefined;
}
