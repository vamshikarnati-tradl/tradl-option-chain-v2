// Column Builder modal. Numeric expression (no boolean-root requirement) +
// format/decimals/side. Shares the editor pane with Rule Builder via
// `<ExpressionPane kind="column">`. The only difference from a rule:
//   - the parse hook is called with requireBoolean=false
//   - no hue picker, no slider; format + decimals + side instead.

import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { GhostBtn, PrimaryBtn } from './atoms';
import { Icon } from './Icon';
import { FunctionPicker } from './FunctionPicker';
import { ExpressionPane } from './rule-builder/ExpressionPane';
import { useExpressionParse } from './rule-builder/useExpressionParse';
import { useCompiledColumns } from './rule-builder/useCompiledColumns';
import { evaluate } from '@tradl/shared';
import { fmtInt, fmtNum } from '../utils/format';
import { validateColumnName } from '../core/column-name';
import type {
  ColumnFormatType, CustomColumnDefinition, OptionChainRow,
} from '../core/types';

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: CustomColumnDefinition;
  rows: readonly OptionChainRow[];
  customColumns?: CustomColumnDefinition[];
  onSave: (col: CustomColumnDefinition) => void;
}

const FORMAT_OPTIONS: ColumnFormatType[] = ['number', 'percentage', 'currency'];
const SIDE_OPTIONS: CustomColumnDefinition['side'][] = ['general', 'call', 'put'];

export function ColumnBuilder({ open, onClose, initial, rows, customColumns, onSave }: Props) {
  const [name, setName] = useState('');
  const [displayLabel, setDisplayLabel] = useState('');
  const [expression, setExpression] = useState('');
  const [format, setFormat] = useState<ColumnFormatType>('number');
  const [decimals, setDecimals] = useState<number>(2);
  const [side, setSide] = useState<CustomColumnDefinition['side']>('general');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setDisplayLabel(initial.displayLabel ?? '');
      setExpression(initial.expression);
      setFormat(initial.format.type);
      setDecimals(initial.format.decimals);
      setSide(initial.side);
    } else {
      setName('');
      setDisplayLabel('');
      setExpression('');
      setFormat('number');
      setDecimals(2);
      setSide('general');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const nameCheck = useMemo(
    () => validateColumnName(name, customColumns ?? [], initial?.id),
    [name, customColumns, initial?.id],
  );

  const parsed = useExpressionParse(
    expression,
    /* requireBoolean */ false,
    customColumns ?? [],
    initial?.id,
  );

  // See RuleBuilder for the rationale — the preview needs compiledColumns
  // so column references resolve via the evaluator's live-eval fallback.
  // Self-id is excluded so a column referencing itself can't quietly
  // infinite-loop in the preview (the engine catches the cycle separately).
  const compiledColumns = useCompiledColumns(customColumns, initial?.id);

  const previewRows = useMemo(() => {
    if (!parsed.ok || !parsed.ast || rows.length === 0) return null;
    const samples = pickSampleRows(rows, 5);
    const ctx = { snapshot: rows, compiledColumns };
    return samples.map((row) => {
      try {
        const v = evaluate(parsed.ast!, row, ctx);
        return {
          row,
          value: Number.isFinite(v) ? v : null,
          error: null as string | null,
        };
      } catch (err) {
        return {
          row,
          value: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }, [parsed.ok, parsed.ast, rows, compiledColumns]);

  const valid = parsed.ok && nameCheck.ok;

  const save = () => {
    if (!valid) return;
    onSave({
      id: initial?.id ?? `col_${Date.now().toString(36)}`,
      name: name.trim(),
      displayLabel: displayLabel.trim() || undefined,
      expression: expression.trim(),
      format: { type: format, decimals: Math.max(0, Math.min(6, decimals)) },
      side,
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
      title={initial ? 'Edit column' : 'New column'}
      subtitle={initial ? initial.id : 'expression · format'}
      width={960}
    >
      <div className="grid grid-cols-[1fr_320px] gap-4">
        <div className="min-w-0">
          {/* Name (identifier) */}
          <div className="flex items-center gap-2 mb-1">
            <label className={`${lbl} w-[50px] flex-none`}>Name</label>
            <input
              className={`${inp} flex-1 min-w-0 ${name && !nameCheck.ok ? 'border-neg/60' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. maxPain"
            />
          </div>
          {name && !nameCheck.ok && (
            <div className="flex items-center gap-2 ml-[58px] mb-2 font-mono text-[10.5px] text-neg">
              <Icon name="x" size={11} />
              <span>{nameCheck.reason}</span>
              {nameCheck.suggestion && (
                <button
                  type="button"
                  onClick={() => setName(nameCheck.suggestion!)}
                  className="text-accent hover:underline"
                >try "{nameCheck.suggestion}"</button>
              )}
            </div>
          )}

          {/* Display label (optional) */}
          <div className="flex items-center gap-2 mb-3">
            <label className={`${lbl} w-[50px] flex-none`}>Label</label>
            <input
              className={`${inp} flex-1 min-w-0`}
              value={displayLabel}
              onChange={(e) => setDisplayLabel(e.target.value)}
              placeholder="optional — friendly label for the table header"
            />
          </div>

          <ExpressionPane
            expression={expression}
            onExpressionChange={setExpression}
            parsed={parsed}
            kind="column"
            availableColumns={customColumns?.filter((c) => c.id !== initial?.id)}
          />

          {/* Format + decimals */}
          <div className="flex items-center gap-2 mt-3">
            <label className={`${lbl} w-[50px] flex-none`}>Format</label>
            <div className="flex gap-0 bg-bg-1 border border-line-2 rounded p-0.5 flex-1">
              {FORMAT_OPTIONS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 px-2.5 py-1 bg-transparent border-0 text-[11px] rounded uppercase tracking-[0.04em] transition-colors ${
                    format === f ? 'bg-bg-3 text-ink' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {f === 'percentage' ? 'percent' : f}
                </button>
              ))}
            </div>
            <label className={`${lbl} ml-2`}>dp</label>
            <input
              type="number"
              min={0}
              max={6}
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
              className="w-14 bg-bg-1 border border-line-2 text-ink text-xs font-mono px-2 py-1 rounded outline-none focus:border-accent text-right"
            />
          </div>

          {/* Side */}
          <div className="flex items-center gap-2 mt-2">
            <label className={`${lbl} w-[50px] flex-none`}>Side</label>
            <div className="flex gap-0 bg-bg-1 border border-line-2 rounded p-0.5 flex-1">
              {SIDE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`flex-1 px-2.5 py-1 bg-transparent border-0 text-[11px] rounded uppercase tracking-[0.04em] transition-colors ${
                    side === s ? 'bg-bg-3 text-ink' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {previewRows && (
            <div className="mt-3 bg-bg-1 border border-line rounded-md p-2.5">
              <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-2">
                Preview · sample strikes
              </div>
              <table className="w-full font-mono text-[10.5px]">
                <thead>
                  <tr className="text-ink-4 text-[9.5px] uppercase tracking-[0.06em]">
                    <th className="text-left py-0.5">strike</th>
                    <th className="text-right py-0.5">value</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((s) => (
                    <tr key={s.row.strikePrice} className="border-t border-line/40">
                      <td className="text-left py-1 tnum">{fmtInt(s.row.strikePrice)}</td>
                      <td className="text-right py-1 tnum">
                        {s.error ? (
                          <span className="text-neg">err</span>
                        ) : s.value === null ? (
                          <span className="text-ink-4">—</span>
                        ) : (
                          formatValue(s.value, format, decimals)
                        )}
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
              {initial ? 'Save changes' : 'Add column'}
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

function formatValue(v: number, format: ColumnFormatType, decimals: number): string {
  if (format === 'percentage') return `${fmtNum(v, decimals)}%`;
  if (format === 'currency') return `₹${fmtNum(v, decimals)}`;
  return fmtNum(v, decimals);
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
