// Rule Builder modal. Boolean-rooted expression + hue + optional slider.
// Layout: editor pane on the left, FunctionPicker right rail. The editor
// pane is the shared `<ExpressionPane>` used by ColumnBuilder too; the only
// rule-specific behavior is `kind='rule'` (enforces boolean root in parse)
// and the rule-only extras (hue picker, slider, preview match column).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../Modal';
import { GhostBtn, PrimaryBtn } from '../atoms';
import { FunctionPicker } from '../FunctionPicker';
import { ExpressionPane } from './ExpressionPane';
import { useExpressionParse } from './useExpressionParse';
import { useCompiledColumns } from './useCompiledColumns';
import { type LiteralRange } from './ExpressionView';
import { SliderBinder, deriveSliderBounds, readBoundLiteral } from './SliderBinder';
import { evaluate } from '@tradl/shared';
import { PALETTE_HUES, ruleHsl } from '../../core/palette';
import { fmtInt, fmtNum } from '../../utils/format';
import type {
  CustomColumnDefinition, OptionChainRow, RuleDefinition, RuleSlider,
} from '../../core/types';

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: RuleDefinition;
  rows: readonly OptionChainRow[];
  customColumns?: CustomColumnDefinition[];
  usedHues: number[];
  onSave: (rule: RuleDefinition) => void;
}

export function RuleBuilder({
  open, onClose, initial, rows, customColumns, usedHues, onSave,
}: Props) {
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [hue, setHue] = useState<number>(PALETTE_HUES[0].hue);
  const [slider, setSlider] = useState<RuleSlider | undefined>(undefined);

  const usedHuesRef = useRef(usedHues);
  useEffect(() => { usedHuesRef.current = usedHues; }, [usedHues]);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setExpression(initial.expression);
      setHue(initial.hue);
      setSlider(initial.slider);
    } else {
      setName('');
      setExpression('');
      const used = new Set(usedHuesRef.current);
      const free = PALETTE_HUES.find((p) => !used.has(p.hue));
      setHue(free ? free.hue : PALETTE_HUES[0].hue);
      setSlider(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const parsed = useExpressionParse(
    expression, /* requireBoolean */ true,
    customColumns ?? [],
  );

  const sliderActiveRange: LiteralRange | null = slider
    ? (() => {
        const start = slider.literalOffset;
        let i = start;
        if (expression[i] === '-') i++;
        let end = i;
        while (end < expression.length && /[0-9.]/.test(expression[end])) end++;
        return end > start ? { start, end } : null;
      })()
    : null;

  // Preview evaluation needs to resolve `columnRef` nodes (`maxPainLevel`,
  // etc.) without help from the engine's per-snapshot columnValues table.
  // Pass the column ASTs so the evaluator's fallback path can live-evaluate
  // each reference recursively.
  const compiledColumns = useCompiledColumns(customColumns);

  const previewRows = useMemo(() => {
    if (!parsed.ok || !parsed.ast || rows.length === 0) return null;
    const samples = pickSampleRows(rows, 5);
    const ctx = { snapshot: rows, compiledColumns };
    return samples.map((row) => {
      try {
        const v = evaluate(parsed.ast!, row, ctx);
        return { row, matched: Number.isFinite(v) && v !== 0, error: null as string | null };
      } catch (err) {
        return { row, matched: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }, [parsed.ok, parsed.ast, rows, compiledColumns]);

  const matchCount = useMemo(() => {
    if (!parsed.ok || !parsed.ast) return 0;
    const ctx = { snapshot: rows, compiledColumns };
    let n = 0;
    for (const row of rows) {
      try {
        const v = evaluate(parsed.ast, row, ctx);
        if (Number.isFinite(v) && v !== 0) n++;
      } catch { /* skip */ }
    }
    return n;
  }, [parsed.ok, parsed.ast, rows, compiledColumns]);

  const bindSlider = (range: LiteralRange) => {
    if (sliderActiveRange
      && sliderActiveRange.start === range.start
      && sliderActiveRange.end === range.end) {
      setSlider(undefined);
      return;
    }
    const slice = expression.slice(range.start, range.end);
    const value = Number(slice);
    if (!Number.isFinite(value)) return;
    const bounds = deriveSliderBounds(value);
    setSlider({
      literalOffset: range.start,
      ...bounds,
      label: 'Threshold',
    });
  };

  const valid = parsed.ok && name.trim().length > 0;

  const save = () => {
    if (!valid) return;
    let nextSlider = slider;
    if (slider) {
      const v = readBoundLiteral(expression, slider);
      if (v === null) nextSlider = undefined;
    }
    onSave({
      id: initial?.id ?? `rule_${Date.now().toString(36)}`,
      name: name.trim(),
      description: initial?.description,
      enabled: initial?.enabled ?? true,
      expression: expression.trim(),
      hue,
      slider: nextSlider,
    });
  };

  const insertSnippet = (snippet: string) => {
    const sep = expression && !/[\s(,]$/.test(expression) ? ' ' : '';
    setExpression(expression + sep + snippet);
  };

  const inp = 'bg-bg-1 border border-line-2 text-ink text-xs font-mono px-2.5 py-1.5 rounded outline-none focus:border-accent';
  const lbl = 'text-[11px] text-ink-3 font-mono uppercase tracking-[0.06em]';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit rule' : 'New rule'}
      subtitle={initial ? initial.id : 'expression · color'}
      width={960}
    >
      <div className="grid grid-cols-[1fr_320px] gap-4">
        <div className="min-w-0">
          {/* Name + hue */}
          <div className="flex items-center gap-2 mb-3">
            <label className={`${lbl} w-[50px] flex-none`}>Name</label>
            <input
              className={`${inp} flex-1 min-w-0`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Put OI Dominance"
            />
            <div className="flex items-center gap-1">
              {PALETTE_HUES.map((p) => (
                <button
                  key={p.hue}
                  type="button"
                  onClick={() => setHue(p.hue)}
                  title={p.name}
                  className={`w-5 h-5 rounded border ${hue === p.hue ? 'border-ink' : 'border-line'}`}
                  style={{ background: ruleHsl(p.hue, 0.9) }}
                />
              ))}
            </div>
          </div>

          <ExpressionPane
            expression={expression}
            onExpressionChange={setExpression}
            parsed={parsed}
            kind="rule"
            activeLiteralRange={sliderActiveRange}
            onLiteralClick={bindSlider}
            availableColumns={customColumns}
          />

          {/* Slider section */}
          {slider ? (
            <div className="mt-2">
              <SliderBinder
                source={expression}
                slider={slider}
                onChange={({ source }) => setExpression(source)}
              />
            </div>
          ) : (
            <div className="mt-2 font-mono text-[10px] text-ink-4">
              Click any number in the expression to bind a slider.
            </div>
          )}

          {/* Preview */}
          {previewRows && (
            <div className="mt-3 bg-bg-1 border border-line rounded-md p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">
                  Preview · {matchCount} of {rows.length} strikes match
                </span>
              </div>
              <table className="w-full font-mono text-[10.5px]">
                <thead>
                  <tr className="text-ink-4 text-[9.5px] uppercase tracking-[0.06em]">
                    <th className="text-left py-0.5">strike</th>
                    <th className="text-right py-0.5">underlying</th>
                    <th className="text-right py-0.5">match</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((s) => (
                    <tr
                      key={s.row.strikePrice}
                      className="border-t border-line/40"
                      style={s.matched ? { background: ruleHsl(hue, 0.12) } : undefined}
                    >
                      <td className="text-left py-1 tnum">{fmtInt(s.row.strikePrice)}</td>
                      <td className="text-right py-1 tnum text-ink-3">{fmtNum(s.row.underlyingValue, 2)}</td>
                      <td className="text-right py-1">
                        {s.error ? <span className="text-neg">err</span>
                          : s.matched ? <span className="text-pos">✓</span>
                          : <span className="text-ink-4">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-1.5 justify-end mt-3">
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn onClick={save} disabled={!valid}>
              {initial ? 'Save changes' : 'Add rule'}
            </PrimaryBtn>
          </div>
        </div>

        <div className="border-l border-line pl-3 min-w-0">
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">
            Library
          </div>
          <FunctionPicker
            open={true}
            onClose={() => { /* embedded — no-op */ }}
            onPick={insertSnippet}
            customColumns={customColumns}
            embedded
          />
        </div>
      </div>
    </Modal>
  );
}

function pickSampleRows(rows: readonly OptionChainRow[], n: number): OptionChainRow[] {
  if (rows.length <= n) return [...rows];
  const spot = rows[0].underlyingValue;
  let atm = 0;
  let bestDist = Math.abs(rows[0].strikePrice - spot);
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(rows[i].strikePrice - spot);
    if (d < bestDist) { bestDist = d; atm = i; }
  }
  const last = rows.length - 1;
  const set = new Set<number>([0, Math.floor(atm / 2), atm, Math.floor((atm + last) / 2), last]);
  return [...set].sort((a, b) => a - b).slice(0, n).map((i) => rows[i]);
}
