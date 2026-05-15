// Compact catalog index that gets sent to the LLM as a starting brief.
// The model walks this tree to decide which functions it needs, then calls
// the server's `getFunctionDetails` tool to fetch full specs only for the
// ones it picks. Names + one-line descriptions; no arg schemas, no examples,
// no restrictions — those are tool-fetched on demand.
//
// What this file does:
//   - Filter the static FUNCTION_CATALOG down to whatever the user can
//     actually run today (`status === 'live'`). Phase 2/3 stubs never reach
//     the LLM, so the model never recommends something that will throw.
//   - Group live functions by category × subgroup using SUBGROUP_CATALOG
//     order. Empty subgroups (everything Phase 2/3) are pruned.
//   - Group the field catalog by side so the model sees the call/put/market
//     split it'll use in expressions.
//   - Inline user-defined custom columns alongside fields — referenceable
//     by name with their description + inferred return type, so the model
//     knows it can write `maxPainLevel > 0` without re-inlining the formula.

import {
  CATEGORY_CATALOG, FIELD_CATALOG, FUNCTION_CATALOG, SUBGROUP_CATALOG,
  type Category, type FunctionSpec, type SubgroupSpec,
} from '@tradl/shared';
import type { CustomColumnDefinition } from './types';

export interface LlmIndexSubgroup {
  name: string;
  description: string;
  functions: string[];
}

export interface LlmIndexCategory {
  id: Category;
  name: string;
  description: string;
  subgroups: LlmIndexSubgroup[];
}

export interface LlmIndexFieldGroup {
  group: 'callSide' | 'putSide' | 'market';
  label: string;
  fields: { name: string; description: string }[];
}

export interface LlmIndexColumn {
  name: string;
  displayLabel?: string;
  description?: string;
  /** What the column's expression returns. Always 'number' today — the
   *  Column Builder doesn't accept boolean roots. Sent so the model can
   *  reason about whether to wrap a column ref in a comparison. */
  returnType: 'number';
}

export interface LlmIndex {
  categories: LlmIndexCategory[];
  fields: LlmIndexFieldGroup[];
  columns: LlmIndexColumn[];
}

const GROUP_LABEL: Record<LlmIndexFieldGroup['group'], string> = {
  market: 'Market (shared)',
  callSide: 'Call side',
  putSide: 'Put side',
};

export function buildLlmIndex(
  columns: readonly CustomColumnDefinition[] = [],
): LlmIndex {
  const liveFns = FUNCTION_CATALOG.filter((f) => f.status === 'live');

  const byCategory = new Map<Category, FunctionSpec[]>();
  for (const f of liveFns) {
    const list = byCategory.get(f.category);
    if (list) list.push(f);
    else byCategory.set(f.category, [f]);
  }

  const subgroupsByCategory = new Map<Category, SubgroupSpec[]>();
  for (const sg of SUBGROUP_CATALOG) {
    const list = subgroupsByCategory.get(sg.category);
    if (list) list.push(sg);
    else subgroupsByCategory.set(sg.category, [sg]);
  }

  const categories: LlmIndexCategory[] = [];
  for (const cat of CATEGORY_CATALOG) {
    if (cat.enabledStatus !== 'live') continue;
    if (cat.id === 'data') continue; // 'data' is fields + columns, not functions
    const fns = byCategory.get(cat.id) ?? [];
    if (!fns.length) continue;
    const subgroups: LlmIndexSubgroup[] = [];
    for (const sg of subgroupsByCategory.get(cat.id) ?? []) {
      const members = fns
        .filter((f) => f.subgroup === sg.name)
        .map((f) => f.technicalName);
      if (!members.length) continue;
      subgroups.push({ name: sg.name, description: sg.description, functions: members });
    }
    categories.push({
      id: cat.id,
      name: cat.friendlyName,
      description: cat.kidDescription,
      subgroups,
    });
  }

  const fieldGroups = new Map<LlmIndexFieldGroup['group'], LlmIndexFieldGroup>();
  for (const g of ['market', 'callSide', 'putSide'] as const) {
    fieldGroups.set(g, { group: g, label: GROUP_LABEL[g], fields: [] });
  }
  for (const f of FIELD_CATALOG) {
    fieldGroups.get(f.group)!.fields.push({ name: f.technicalName, description: f.description });
  }

  const columnEntries: LlmIndexColumn[] = columns.map((c) => ({
    name: c.name,
    displayLabel: c.displayLabel,
    description: c.description,
    returnType: 'number',
  }));

  return {
    categories,
    fields: Array.from(fieldGroups.values()),
    columns: columnEntries,
  };
}
