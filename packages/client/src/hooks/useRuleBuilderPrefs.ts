// Persists the user's last-used display preferences for the rule builder:
// which mode (Expression vs Visual) they prefer to open in, and whether
// the text editor is in one-line or multi-line pretty form. Saved as a
// single global record — not per-rule.

import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../core/storage-keys';

export type RuleBuilderMode = 'expression' | 'visual';
export type RuleBuilderPretty = 'oneLine' | 'multiLine';

export interface RuleBuilderPrefs {
  mode: RuleBuilderMode;
  pretty: RuleBuilderPretty;
}

const DEFAULT: RuleBuilderPrefs = { mode: 'expression', pretty: 'oneLine' };

function load(): RuleBuilderPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ruleBuilderPrefs);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<RuleBuilderPrefs>;
    return {
      mode: parsed.mode === 'visual' ? 'visual' : 'expression',
      pretty: parsed.pretty === 'multiLine' ? 'multiLine' : 'oneLine',
    };
  } catch {
    return DEFAULT;
  }
}

function save(prefs: RuleBuilderPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ruleBuilderPrefs, JSON.stringify(prefs));
  } catch {
    // ignore quota errors
  }
}

export function useRuleBuilderPrefs(): {
  prefs: RuleBuilderPrefs;
  setMode: (mode: RuleBuilderMode) => void;
  setPretty: (pretty: RuleBuilderPretty) => void;
} {
  const [prefs, setPrefs] = useState<RuleBuilderPrefs>(() => load());

  useEffect(() => { save(prefs); }, [prefs]);

  const setMode = useCallback(
    (mode: RuleBuilderMode) => setPrefs((p) => ({ ...p, mode })),
    [],
  );
  const setPretty = useCallback(
    (pretty: RuleBuilderPretty) => setPrefs((p) => ({ ...p, pretty })),
    [],
  );

  return { prefs, setMode, setPretty };
}
