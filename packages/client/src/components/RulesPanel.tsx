import { useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { ConditionChips } from './ConditionChips';
import { GhostBtn, PrimaryBtn, Switch } from './atoms';
import { fmtCompact } from '../utils/format';
import { PALETTE_HUES, nextUnusedHue, ruleFg, ruleHsl } from '../core/palette';
import type { Condition, NumericField, Operator, RuleDefinition, RuleSlider } from '../core/types';
import { NUMERIC_FIELDS } from '../core/types';

const OP_OPTIONS: { v: Operator; l: string }[] = [
  { v: 'gt',  l: '>' }, { v: 'gte', l: '≥' },
  { v: 'lt',  l: '<' }, { v: 'lte', l: '≤' },
  { v: 'eq',  l: '=' }, { v: 'neq', l: '≠' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  rules: RuleDefinition[];
  ruleCounts: Record<string, number>;
  ruleErrors: { ruleId: string; error: string }[];
  onChange: (rules: RuleDefinition[]) => void;
}

function describeCondition(c: Condition, sliderValue?: number): string {
  const lhs = c.lhs.kind === 'field' ? c.lhs.field : c.lhs.expression;
  const op = OP_OPTIONS.find((o) => o.v === c.operator)?.l ?? c.operator;
  const fallbackRhs =
    c.rhs.kind === 'literal' ? String(c.rhs.value) :
    c.rhs.kind === 'field' ? c.rhs.field :
    c.rhs.kind === 'expr' ? c.rhs.expression :
    `[${c.rhs.value[0]}, ${c.rhs.value[1]}]`;
  const rhs = sliderValue !== undefined && c.rhs.kind === 'literal' ? String(sliderValue) : fallbackRhs;
  return `${lhs} ${op} ${rhs}`;
}

function getSliderValue(rule: RuleDefinition): number | null {
  if (!rule.slider) return null;
  const cond = rule.conditions[rule.slider.conditionIndex];
  if (cond?.rhs.kind === 'literal') return cond.rhs.value;
  return null;
}

function setSliderValue(rule: RuleDefinition, value: number): RuleDefinition {
  if (!rule.slider) return rule;
  const idx = rule.slider.conditionIndex;
  const conditions = rule.conditions.map((c, i) =>
    i === idx && c.rhs.kind === 'literal' ? { ...c, rhs: { kind: 'literal' as const, value } } : c,
  );
  return { ...rule, conditions };
}

function newRule(existing: RuleDefinition[]): RuleDefinition {
  const hue = nextUnusedHue(existing.map((r) => r.style.hue));
  return {
    id: `custom_${Date.now()}`,
    name: 'New rule',
    description: '',
    enabled: true,
    logic: 'AND',
    conditions: [
      { lhs: { kind: 'field', field: 'call_oi' }, operator: 'gt', rhs: { kind: 'literal', value: 50_000 } },
    ],
    style: { hue, scope: 'call' },
    slider: { conditionIndex: 0, min: 0, max: 200_000, step: 1000, label: 'Threshold' },
  };
}

interface SliderProps {
  slider: RuleSlider;
  value: number;
  onChange: (v: number) => void;
}

function ThresholdSlider({ slider, value, onChange }: SliderProps) {
  return (
    <div className="bg-bg-1 border border-line rounded-md py-2.5 px-3 mb-2">
      <div className="flex justify-between items-baseline mb-2">
        <label className="text-[11px] text-ink-2">{slider.label}</label>
        <input
          type="number"
          value={value}
          step={slider.step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="bg-bg-2 border border-line-2 text-ink font-mono text-[11px] w-[90px] px-2 py-1 rounded text-right outline-none focus:border-accent"
        />
      </div>
      <input
        type="range"
        className="thr-range w-full my-1"
        min={slider.min} max={slider.max} step={slider.step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <div className="flex justify-between font-mono text-[9.5px] text-ink-4">
        <span>{fmtCompact(slider.min)}</span>
        <span>{fmtCompact(slider.max)}</span>
      </div>
    </div>
  );
}

interface CardProps {
  rule: RuleDefinition;
  expanded: boolean;
  matchCount: number;
  error?: string;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onUpdate: (patch: Partial<RuleDefinition>) => void;
  onDelete: () => void;
  isUserCreated: boolean;
}

function RuleCard({
  rule, expanded, matchCount, error,
  onToggleExpand, onToggleEnabled, onUpdate, onDelete, isUserCreated,
}: CardProps) {
  const sliderValue = getSliderValue(rule);
  const liveRhsAt = rule.slider && sliderValue != null
    ? { index: rule.slider.conditionIndex, value: sliderValue }
    : undefined;

  return (
    <div className={`rounded-lg mb-1.5 border transition-colors ${
      expanded ? 'border-line-2 bg-bg-2' : 'border-line bg-bg-2 hover:border-line-2'
    } ${rule.enabled ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2.5 p-3 cursor-pointer" onClick={onToggleExpand}>
        <Switch checked={rule.enabled} onChange={onToggleEnabled} ariaLabel="Toggle rule" />
        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: ruleHsl(rule.style.hue, 0.9) }} />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-ink">{rule.name}</div>
          <div className="font-mono text-[10.5px] text-ink-3 mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
            {rule.conditions.map((c, i) => (
              <span key={i} className="mr-1.5">
                {describeCondition(c, i === rule.slider?.conditionIndex ? sliderValue ?? undefined : undefined)}
                {i < rule.conditions.length - 1 ? ` ${rule.logic}` : ''}
              </span>
            ))}
          </div>
        </div>
        {rule.enabled && matchCount > 0 && (
          <span
            className="font-mono text-[11px] font-semibold px-1.5 py-0.5 bg-bg-3 rounded-[10px] min-w-[20px] text-center"
            style={{ color: ruleFg(rule.style.hue) }}
          >{matchCount}</span>
        )}
        <Icon name={expanded ? 'chevDown' : 'chevRight'} size={14} />
      </div>

      {error && (
        <div className="mx-3 mb-2 text-[10px] text-neg bg-pill-neg border border-pill-neg-border rounded px-2 py-1 font-mono">
          {error}
        </div>
      )}

      {expanded && (
        <div className="px-3.5 pt-3 pb-3.5 border-t border-line">
          {rule.description && (
            <p className="text-[11.5px] text-ink-2 m-0 mb-3 leading-[1.5]" style={{ textWrap: 'pretty' }}>
              {rule.description}
            </p>
          )}

          <div className="mb-3">
            <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">Conditions</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ConditionChips conditions={rule.conditions} logic={rule.logic} size="sm" liveRhsAt={liveRhsAt} />
            </div>
          </div>

          {rule.slider && sliderValue !== null && (
            <ThresholdSlider
              slider={rule.slider}
              value={sliderValue}
              onChange={(v) => onUpdate(setSliderValue(rule, v))}
            />
          )}

          {isUserCreated && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 bg-transparent border-0 text-ink-3 text-[11px] py-1 mt-2 hover:text-neg"
            >
              <Icon name="trash" size={13} /> Delete rule
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface BuilderProps {
  existing: RuleDefinition[];
  onCreate: (rule: RuleDefinition) => void;
  onCancel: () => void;
}

function RuleBuilder({ existing, onCreate, onCancel }: BuilderProps) {
  const [name, setName] = useState('');
  const [field, setField] = useState<NumericField>('call_oi');
  const [op, setOp] = useState<Operator>('gt');
  const [value, setValue] = useState<number>(50_000);
  const [target, setTarget] = useState<'call' | 'put' | 'row'>('call');
  const [hue, setHue] = useState<number>(nextUnusedHue(existing.map((r) => r.style.hue)));

  const create = () => {
    if (!name.trim()) return;
    onCreate({
      id: `custom_${Date.now()}`,
      name: name.trim(),
      description: `Custom: ${field} ${op} ${value}`,
      enabled: true,
      logic: 'AND',
      conditions: [{ lhs: { kind: 'field', field }, operator: op, rhs: { kind: 'literal', value } }],
      style: { hue, scope: target },
      slider: {
        conditionIndex: 0,
        min: 0,
        max: Math.max(value * 4, 100_000),
        step: Math.max(1, Math.round(value / 100)),
        label: name.trim() + ' threshold',
      },
    });
  };

  const inp = 'bg-bg-1 border border-line-2 text-ink text-xs font-mono px-2.5 py-1.5 rounded outline-none focus:border-accent flex-1 min-w-0';
  const inpNarrow = 'bg-bg-1 border border-line-2 text-ink text-xs font-mono px-2.5 py-1.5 rounded outline-none focus:border-accent flex-none w-[70px]';
  const inpValue  = 'bg-bg-1 border border-line-2 text-ink text-xs font-mono px-2.5 py-1.5 rounded outline-none focus:border-accent flex-none w-[110px]';
  const lbl = 'text-[11px] text-ink-3 w-[60px] flex-none font-mono uppercase tracking-[0.06em]';

  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <label className={lbl}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Big Call OI" className={inp} />
      </div>

      <div className="flex items-center gap-1 mb-2.5">
        <label className={lbl}>If</label>
        <select className={inp} value={field} onChange={(e) => setField(e.target.value as NumericField)}>
          {NUMERIC_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className={inpNarrow} value={op} onChange={(e) => setOp(e.target.value as Operator)}>
          {OP_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <input type="number" className={inpValue} value={value} onChange={(e) => setValue(parseFloat(e.target.value) || 0)} />
      </div>

      <div className="flex items-center gap-2 mb-2.5">
        <label className={lbl}>Highlight</label>
        <div className="flex gap-0 bg-bg-1 border border-line-2 rounded p-0.5 flex-1">
          {(['call', 'put', 'row'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTarget(t)}
              className={`flex-1 px-2.5 py-1 bg-transparent border-0 text-[11px] rounded uppercase tracking-[0.04em] transition-colors ${
                target === t ? 'bg-bg-3 text-ink' : 'text-ink-3 hover:text-ink-2'
              }`}
            >{t}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2.5">
        <label className={lbl}>Color</label>
        <div className="flex gap-1 flex-wrap">
          {PALETTE_HUES.map((p) => (
            <button
              key={p.hue}
              onClick={() => setHue(p.hue)}
              title={p.name}
              className={`w-[18px] h-[18px] rounded border-[1.5px] ${hue === p.hue ? 'border-white' : 'border-transparent'}`}
              style={{ background: `hsl(${p.hue}, 75%, 55%)` }}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 justify-end mt-1.5">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn onClick={create} disabled={!name.trim()}>Add rule</PrimaryBtn>
      </div>
    </div>
  );
}

export function RulesPanel({
  open, onClose, rules, ruleCounts, ruleErrors, onChange,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [search, setSearch] = useState('');
  const errorById = new Map(ruleErrors.map((e) => [e.ruleId, e.error]));

  const filtered = rules.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  const enabledCount = rules.filter((r) => r.enabled).length;

  const updateRule = (id: string, patch: Partial<RuleDefinition>) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const toggleEnabled = (id: string) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };
  const removeRule = (id: string) => {
    if (!confirm('Delete this rule?')) return;
    onChange(rules.filter((r) => r.id !== id));
    if (expanded === id) setExpanded(null);
  };
  const addRule = (rule: RuleDefinition) => {
    onChange([...rules, rule]);
    setBuilding(false);
    setExpanded(rule.id);
  };

  return (
    <aside className={`fixed top-0 right-0 bottom-0 w-full sm:w-[380px] bg-bg-1 border-l border-line flex flex-col z-50 shadow-[-8px_0_24px_rgba(0,0,0,0.4)] transition-transform duration-300 ${
      open ? 'translate-x-0' : 'translate-x-full'
    }`}>
      <div className="flex items-center justify-between h-12 pl-4 pr-3 border-b border-line shrink-0">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Icon name="bolt" size={15} className="text-accent" />
          <span>Rule engine</span>
          <span className="font-mono text-[10.5px] text-ink-3 font-normal ml-1">{enabledCount}/{rules.length} active</span>
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
        {filtered.map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            expanded={expanded === r.id}
            matchCount={ruleCounts[r.id] ?? 0}
            error={errorById.get(r.id)}
            isUserCreated={r.id.startsWith('custom_')}
            onToggleExpand={() => setExpanded(expanded === r.id ? null : r.id)}
            onToggleEnabled={() => toggleEnabled(r.id)}
            onUpdate={(patch) => updateRule(r.id, patch)}
            onDelete={() => removeRule(r.id)}
          />
        ))}
      </div>

      <div className="p-3 border-t border-line shrink-0">
        <PrimaryBtn onClick={() => setBuilding(true)} className="w-full">
          <Icon name="plus" size={14} /> New rule
        </PrimaryBtn>
      </div>

      <Modal
        open={building}
        onClose={() => setBuilding(false)}
        title="New rule"
        subtitle="condition · scope · color"
      >
        <RuleBuilder existing={rules} onCancel={() => setBuilding(false)} onCreate={addRule} />
      </Modal>
    </aside>
  );
}

// Re-export so App.tsx can spawn a fresh rule programmatically if needed.
export { newRule };
