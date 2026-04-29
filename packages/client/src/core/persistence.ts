import type { CustomColumnDefinition, RuleDefinition } from './types';
import { PREDEFINED_COLUMNS, PREDEFINED_RULES } from './predefined';
import { hueFromHex, PALETTE_HUES } from './palette';

const RULES_KEY = 'tradl.rules.v1';
const COLUMNS_KEY = 'tradl.columns.v1';

const PREDEFINED_BY_ID = new Map(PREDEFINED_RULES.map((r) => [r.id, r]));

function isLegacyShape(raw: any): boolean {
  // Old shape used { color: hex } or { backgroundColor: rgba(...) }.
  // New shape uses { hue: number }.
  return raw?.style && typeof raw.style.hue !== 'number';
}

function migrateRule(raw: any, idx: number): RuleDefinition {
  // Preserve enabled state but pull conditions/slider/style from the latest
  // predefined definition when the id matches a built-in rule. This keeps
  // users from being stuck on stale thresholds after we ship new defaults.
  const predefined = PREDEFINED_BY_ID.get(raw?.id);
  if (predefined && isLegacyShape(raw)) {
    return { ...predefined, enabled: raw.enabled !== false };
  }

  // For custom rules (or already-modern predefined), just normalize the style.
  const style = raw?.style ?? {};
  let hue: number;
  if (typeof style.hue === 'number') {
    hue = style.hue;
  } else if (typeof style.color === 'string') {
    hue = hueFromHex(style.color);
  } else if (typeof style.backgroundColor === 'string') {
    const m = style.backgroundColor.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const hex = `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`;
      hue = hueFromHex(hex);
    } else {
      hue = PALETTE_HUES[idx % PALETTE_HUES.length].hue;
    }
  } else {
    hue = PALETTE_HUES[idx % PALETTE_HUES.length].hue;
  }
  return {
    ...raw,
    style: {
      hue,
      scope: style.scope ?? 'row',
      icon: style.icon,
    },
  } as RuleDefinition;
}

export function loadRules(): RuleDefinition[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return PREDEFINED_RULES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return PREDEFINED_RULES;
    return parsed.map(migrateRule);
  } catch {
    return PREDEFINED_RULES;
  }
}

export function saveRules(rules: RuleDefinition[]): void {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    // quota exceeded — silently ignore
  }
}

export function loadColumns(): CustomColumnDefinition[] {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY);
    if (!raw) return PREDEFINED_COLUMNS;
    const parsed = JSON.parse(raw) as CustomColumnDefinition[];
    if (!Array.isArray(parsed)) return PREDEFINED_COLUMNS;
    return parsed;
  } catch {
    return PREDEFINED_COLUMNS;
  }
}

export function saveColumns(columns: CustomColumnDefinition[]): void {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns));
  } catch {
    // ignore
  }
}

export function resetAll(): void {
  localStorage.removeItem(RULES_KEY);
  localStorage.removeItem(COLUMNS_KEY);
}
