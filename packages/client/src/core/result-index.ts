// Inverts the rule/column result lists into per-strike + per-cell lookups for
// O(1) read in the table. Cell-level tinting comes from `byCell`: every
// (strike, field) → list of rules whose evaluation actually read `field` on
// that row (per `evaluateWithTrace`, respecting short-circuit + ternary
// branch selection).

import type {
  ColumnCellResult, ColumnResult, CustomColumnDefinition, NumericField,
  RuleDefinition, RuleResult,
} from './types';
import { ruleBg, ruleHsl } from './palette';

export interface AppliedRule {
  rule: RuleDefinition;
  /** Fields the engine actually read on this row while evaluating the rule. */
  affectedFields: NumericField[];
  /** Saved-column ids the rule consulted on this row. Drives column-cell tinting. */
  affectedColumns: string[];
}

export interface RuleHighlight {
  byStrike: Map<number, AppliedRule[]>;
  byCell: Map<number, Map<NumericField, AppliedRule[]>>;
  /** Cell-tint index for CUSTOM column cells, keyed by (strike, columnId).
   *  When a rule references `maxPainLevel`, the maxPainLevel cell at the
   *  matching strike picks up the rule's tint via this map. */
  byColumnCell: Map<number, Map<string, AppliedRule[]>>;
}

export function indexRuleResults(
  results: RuleResult[],
  rulesById: Map<string, RuleDefinition>,
): RuleHighlight {
  const byStrike = new Map<number, AppliedRule[]>();
  const byCell = new Map<number, Map<NumericField, AppliedRule[]>>();
  const byColumnCell = new Map<number, Map<string, AppliedRule[]>>();
  for (const r of results) {
    const def = rulesById.get(r.ruleId);
    if (!def) continue;
    for (const m of r.matches) {
      const entry: AppliedRule = {
        rule: def,
        affectedFields: m.affectedFields,
        affectedColumns: m.affectedColumns ?? [],
      };
      const sList = byStrike.get(m.strikePrice);
      if (sList) sList.push(entry); else byStrike.set(m.strikePrice, [entry]);

      let cellMap = byCell.get(m.strikePrice);
      if (!cellMap) { cellMap = new Map(); byCell.set(m.strikePrice, cellMap); }
      for (const f of m.affectedFields) {
        const list = cellMap.get(f);
        if (list) list.push(entry); else cellMap.set(f, [entry]);
      }
      if (entry.affectedColumns.length > 0) {
        let colMap = byColumnCell.get(m.strikePrice);
        if (!colMap) { colMap = new Map(); byColumnCell.set(m.strikePrice, colMap); }
        for (const id of entry.affectedColumns) {
          const list = colMap.get(id);
          if (list) list.push(entry); else colMap.set(id, [entry]);
        }
      }
    }
  }
  return { byStrike, byCell, byColumnCell };
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
// stacked 2px inset rings. Caps additional rings at 3 to avoid visual chaos.
export function bgForCell(rules: AppliedRule[] | undefined): CellStyle {
  if (!rules?.length) return {};
  const [dominant, ...rest] = rules;
  const background = ruleBg(dominant.rule.hue, 0.18);
  if (!rest.length) return { background };
  const rings = rest.slice(0, 3).map((r, i) =>
    `inset 0 0 0 ${2 + i * 2}px ${ruleHsl(r.rule.hue, 0.75)}`,
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
