// Rules sidebar — lists rules, lets users toggle/edit/delete, and opens the
// new RuleBuilder modal for create/edit flows. The card shows a small
// visual rendering of the expression so non-technical users can recognize
// what each rule does at a glance.

import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { PrimaryBtn, Switch } from './atoms';
import { RuleBuilder } from './rule-builder/RuleBuilder';
import { ExpressionView } from './rule-builder/ExpressionView';
import { SliderBinder, readBoundLiteral } from './rule-builder/SliderBinder';
import { type Expr } from '@tradl/shared';
import { parseAndResolve } from '../core/parse-and-resolve';
import { ruleFg, ruleHsl } from '../core/palette';
import type {
  CustomColumnDefinition, OptionChainRow, RuleDefinition,
} from '../core/types';

interface Props {
  open: boolean;
  onClose: () => void;
  rules: RuleDefinition[];
  ruleCounts: Record<string, number>;
  ruleErrors: { ruleId: string; error: string }[];
  rows: readonly OptionChainRow[];
  columns: CustomColumnDefinition[];
  onChange: (rules: RuleDefinition[]) => void;
}

export function RulesPanel({
  open, onClose, rules, ruleCounts, ruleErrors, rows, columns, onChange,
}: Props) {
  const [editing, setEditing] = useState<RuleDefinition | null>(null);
  const [building, setBuilding] = useState(false);
  const [search, setSearch] = useState('');
  const errorById = new Map(ruleErrors.map((e) => [e.ruleId, e.error]));

  const filtered = useMemo(
    () => rules.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
    [rules, search],
  );

  const usedHues = rules.map((r) => r.hue);
  const enabledCount = rules.filter((r) => r.enabled).length;

  const updateRule = (next: RuleDefinition) => {
    onChange(rules.map((r) => (r.id === next.id ? next : r)));
  };

  const toggleEnabled = (id: string) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const removeRule = (id: string) => {
    if (!confirm('Delete this rule?')) return;
    onChange(rules.filter((r) => r.id !== id));
  };

  const upsert = (rule: RuleDefinition) => {
    const idx = rules.findIndex((r) => r.id === rule.id);
    if (idx < 0) onChange([...rules, rule]);
    else onChange(rules.map((r, i) => i === idx ? rule : r));
    setBuilding(false);
    setEditing(null);
  };

  return (
    <aside className={`fixed top-0 right-0 bottom-0 w-full sm:w-[380px] bg-bg-1 border-l border-line flex flex-col z-50 shadow-[-8px_0_24px_rgba(0,0,0,0.4)] transition-transform duration-300 ${
      open ? 'translate-x-0' : 'translate-x-full'
    }`}>
      <div className="flex items-center justify-between h-12 pl-4 pr-3 border-b border-line shrink-0">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Icon name="bolt" size={15} className="text-accent" />
          <span>Rules</span>
          <span className="font-mono text-[10.5px] text-ink-3 font-normal ml-1">
            {enabledCount}/{rules.length} active
          </span>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition-colors">
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line shrink-0">
        <Icon name="search" size={13} className="text-ink-3 shrink-0" />
        <input
          placeholder="Search rules…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent border-0 outline-0 text-ink text-xs font-mono placeholder:text-ink-3"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && rules.length === 0 && (
          <div className="flex flex-col items-center justify-center px-5 py-10 text-ink-3 text-center">
            <Icon name="bolt" size={20} className="text-ink-4 mb-3" />
            <p className="m-0 mb-1.5 text-[12.5px]">No rules yet.</p>
            <p className="text-[11px] leading-[1.6] max-w-[260px]">
              Build one with an expression that returns true or false, like{' '}
              <code className="bg-bg-3 px-1 py-px rounded font-mono text-[10px] text-codeblock">put_oi {'>'} call_oi * 3</code>.
            </p>
          </div>
        )}
        {filtered.map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            matchCount={ruleCounts[r.id] ?? 0}
            error={errorById.get(r.id)}
            columns={columns}
            onEdit={() => setEditing(r)}
            onDelete={() => removeRule(r.id)}
            onToggle={() => toggleEnabled(r.id)}
            onSliderChange={(nextSource) => updateRule({ ...r, expression: nextSource })}
          />
        ))}
      </div>

      <div className="p-3 border-t border-line shrink-0">
        <PrimaryBtn onClick={() => setBuilding(true)} className="w-full">
          <Icon name="plus" size={14} /> New rule
        </PrimaryBtn>
      </div>

      <RuleBuilder
        open={building || editing !== null}
        onClose={() => { setBuilding(false); setEditing(null); }}
        initial={editing ?? undefined}
        rows={rows}
        customColumns={columns}
        usedHues={usedHues}
        onSave={upsert}
      />
    </aside>
  );
}

function RuleCard({
  rule, matchCount, error, columns, onEdit, onDelete, onToggle, onSliderChange,
}: {
  rule: RuleDefinition;
  matchCount: number;
  error?: string;
  columns: CustomColumnDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onSliderChange: (nextSource: string) => void;
}) {
  // Parse-and-resolve once for the visual preview. The expression can
  // reference saved columns by name — strict `parseExpression` would
  // reject those as unknown identifiers, so we use the loose+resolve
  // pipeline with the live columns list as the resolver's name lookup.
  let ast: Expr | null = null;
  let parseError: string | null = error ?? null;
  try {
    ast = parseAndResolve(rule.expression, columns);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
  const sliderValue = rule.slider ? readBoundLiteral(rule.expression, rule.slider) : null;

  return (
    <div className={`rounded-lg mb-1.5 border ${parseError ? 'border-neg/60' : 'border-line'} bg-bg-2 ${rule.enabled ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2.5 p-3">
        <Switch checked={rule.enabled} onChange={onToggle} ariaLabel="Toggle rule" />
        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: ruleHsl(rule.hue, 0.9) }} />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-ink truncate">{rule.name}</div>
          {ast ? (
            <div className="mt-1">
              <ExpressionView ast={ast} compact />
            </div>
          ) : (
            <div className="font-mono text-[10.5px] text-ink-3 mt-0.5 truncate">
              {rule.expression}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {rule.enabled && matchCount > 0 && (
            <span
              className="font-mono text-[11px] font-semibold px-1.5 py-0.5 bg-bg-3 rounded-[10px] min-w-[20px] text-center mr-1"
              style={{ color: ruleFg(rule.hue) }}
            >{matchCount}</span>
          )}
          <button onClick={onEdit} className="bg-transparent border-0 text-ink-3 p-0.5 rounded hover:text-ink hover:bg-bg-3" title="Edit">
            <Icon name="edit" size={12} />
          </button>
          <button onClick={onDelete} className="bg-transparent border-0 text-ink-3 p-0.5 rounded hover:text-neg hover:bg-bg-3" title="Delete">
            <Icon name="trash" size={12} />
          </button>
        </div>
      </div>

      {parseError && (
        <div className="mx-3 mb-2 text-[10px] text-neg bg-pill-neg border border-pill-neg-border rounded px-2 py-1 font-mono">
          {parseError}
        </div>
      )}

      {rule.slider && sliderValue !== null && (
        <div className="px-3 pb-3">
          <SliderBinder
            source={rule.expression}
            slider={rule.slider}
            onChange={({ source }) => onSliderChange(source)}
          />
        </div>
      )}
    </div>
  );
}
