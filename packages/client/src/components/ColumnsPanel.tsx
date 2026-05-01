import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { GhostBtn, PrimaryBtn } from './atoms';
import { fmtNum } from '../utils/format';
import { extractDependencies, parseExpression } from '../core/expression-parser';
import { evaluate } from '../core/expression-evaluator';
import { NUMERIC_FIELDS } from '../core/types';
import type { ColumnFormatType, CustomColumnDefinition, OptionChainRow } from '../core/types';

interface CompiledExpr {
  ok: boolean;
  error?: string;
  deps: string[];
  evaluate: (row: OptionChainRow) => { ok: boolean; value?: number; error?: string };
}

function compileExpression(src: string): CompiledExpr {
  try {
    const ast = parseExpression(src);
    const deps = extractDependencies(ast);
    return {
      ok: true,
      deps,
      evaluate: (row) => {
        try {
          const v = evaluate(ast, row);
          if (!Number.isFinite(v)) return { ok: false, error: 'non-finite' };
          return { ok: true, value: v };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      deps: [],
      evaluate: () => ({ ok: false, error: 'parse failed' }),
    };
  }
}

const PRESET_IDS = new Set(['col_pcr', 'col_str']);

interface CardProps {
  col: CustomColumnDefinition;
  valid: boolean;
  error?: string;
  sampleValue: number | null;
  deps: string[];
  isPreset: boolean;
  onDelete: () => void;
}

function ColumnCard({ col, valid, error, sampleValue, deps, isPreset, onDelete }: CardProps) {
  return (
    <div className={`bg-bg-2 rounded-lg py-2.5 px-3 mb-1.5 border ${valid ? 'border-line' : 'border-neg/60'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[12.5px] font-medium">{col.name}</div>
        {isPreset ? (
          <span className="font-mono text-[9.5px] bg-bg-3 text-ink-3 px-1.5 py-0.5 rounded uppercase tracking-[0.06em]">preset</span>
        ) : (
          <button onClick={onDelete} className="bg-transparent border-0 text-ink-3 p-0.5 rounded hover:text-neg hover:bg-bg-3">
            <Icon name="trash" size={12} />
          </button>
        )}
      </div>
      <code className="block bg-bg-1 border border-line px-2 py-1.5 rounded font-mono text-[11px] text-codeblock break-all mb-1.5">{col.expression}</code>
      <div className="flex justify-between font-mono text-[10.5px]">
        <span className="text-ink-3">{deps.length ? deps.join(' · ') : 'no fields'}</span>
        {valid ? (
          <span className="text-pos">~{fmtNum(sampleValue, 2)}</span>
        ) : (
          <span className="text-neg">{error}</span>
        )}
      </div>
    </div>
  );
}

interface ExprInputProps {
  value: string;
  onChange: (v: string) => void;
}

function ExpressionInput({ value, onChange }: ExprInputProps) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. (call_ltp + put_ltp)"
        rows={2}
        spellCheck={false}
        className="w-full bg-bg-1 border border-line-2 text-ink font-mono text-xs px-2.5 py-2 rounded resize-y outline-none leading-[1.5] focus:border-accent"
      />
      <div className="flex items-center justify-between mt-1.5">
        <button
          onClick={() => setShowHelp((s) => !s)}
          className="inline-flex items-center gap-1 bg-bg-1 border border-line text-ink-3 text-[10.5px] px-1.5 py-0.5 rounded hover:text-ink hover:border-line-2"
        >
          <Icon name="info" size={12} /> {showHelp ? 'hide' : 'syntax'}
        </button>
        <span className="font-mono text-[10px] text-ink-4">fields · ops · abs() max() min() round() · cond ? a : b</span>
      </div>
      {showHelp && (
        <div className="mt-2 bg-bg-1 border border-line rounded-md p-2.5">
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="font-mono text-[9.5px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">Fields</div>
              <div className="flex flex-wrap gap-1">
                {NUMERIC_FIELDS.map((f) => (
                  <button
                    key={f}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange((value || '') + (value && !value.endsWith(' ') ? ' ' : '') + f);
                    }}
                    className="bg-bg-3 border-0 text-ink-2 font-mono text-[10.5px] px-1.5 py-0.5 rounded hover:bg-accent hover:text-black"
                  >{f}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-[9.5px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">Examples</div>
              <ul className="list-none p-0 m-0 text-[11px] text-ink-2">
                <li className="py-0.5"><code className="bg-bg-3 px-1 py-px rounded font-mono text-[10.5px] text-codeblock mr-1">put_oi / call_oi</code> — PCR</li>
                <li className="py-0.5"><code className="bg-bg-3 px-1 py-px rounded font-mono text-[10.5px] text-codeblock mr-1">call_ltp + put_ltp</code> — straddle</li>
                <li className="py-0.5"><code className="bg-bg-3 px-1 py-px rounded font-mono text-[10.5px] text-codeblock mr-1">abs(call_iv - put_iv)</code> — IV gap</li>
                <li className="py-0.5"><code className="bg-bg-3 px-1 py-px rounded font-mono text-[10.5px] text-codeblock mr-1">(strikePrice - underlyingValue) / underlyingValue * 100</code> — moneyness%</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface BuilderProps {
  sampleRow?: OptionChainRow;
  onCreate: (col: CustomColumnDefinition) => void;
  onCancel: () => void;
}

function ColumnBuilder({ sampleRow, onCreate, onCancel }: BuilderProps) {
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [format, setFormat] = useState<ColumnFormatType>('number');

  const compiled = useMemo<CompiledExpr | null>(
    () => (expression.trim() ? compileExpression(expression) : null),
    [expression],
  );

  const sample = useMemo<number | null>(() => {
    if (!compiled?.ok || !sampleRow) return null;
    const r = compiled.evaluate(sampleRow);
    return r.ok && r.value !== undefined ? r.value : null;
  }, [compiled, sampleRow]);

  const valid = !!(compiled?.ok && name.trim());

  const create = () => {
    if (!valid) return;
    onCreate({
      id: `col_${Date.now()}`,
      name: name.trim(),
      expression: expression.trim(),
      format: { type: format, decimals: 2 },
      side: 'general',
    });
  };

  const inp = 'bg-bg-1 border border-line-2 text-ink text-xs font-mono px-2.5 py-1.5 rounded outline-none focus:border-accent flex-1 min-w-0';
  const lbl = 'text-[11px] text-ink-3 font-mono uppercase tracking-[0.06em]';

  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <label className={`${lbl} w-[60px] flex-none`}>Name</label>
        <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PCR" />
      </div>
      <div className="flex flex-col items-stretch gap-1.5 mb-2.5">
        <label className={`${lbl} mb-1`}>Expression</label>
        <ExpressionInput value={expression} onChange={setExpression} />
      </div>

      {compiled && (
        <div className={`flex items-center gap-1.5 font-mono text-[10.5px] px-2 py-1.5 rounded mb-2.5 ${
          compiled.ok ? 'bg-pill-pos text-pos' : 'bg-pill-neg text-neg'
        }`}>
          {compiled.ok ? (
            <>
              <Icon name="check" size={12} />
              <span>parsed · uses {compiled.deps.join(', ') || '—'}</span>
              {sample !== null && <span className="ml-auto text-ink-2">≈ {fmtNum(sample, 2)}</span>}
            </>
          ) : (
            <>
              <Icon name="x" size={12} />
              <span>{compiled.error}</span>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mb-2.5">
        <label className={`${lbl} w-[60px] flex-none`}>Format</label>
        <div className="flex gap-0 bg-bg-1 border border-line-2 rounded p-0.5 flex-1">
          {(['number', 'percentage'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`flex-1 px-2.5 py-1 bg-transparent border-0 text-[11px] rounded uppercase tracking-[0.04em] transition-colors ${
                format === f ? 'bg-bg-3 text-ink' : 'text-ink-3 hover:text-ink-2'
              }`}
            >{f === 'percentage' ? 'percent' : f}</button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 justify-end mt-1.5">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn onClick={create} disabled={!valid}>Add column</PrimaryBtn>
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  columns: CustomColumnDefinition[];
  columnErrors: { columnId: string; error: string }[];
  sampleRow?: OptionChainRow;
  onChange: (cols: CustomColumnDefinition[]) => void;
}

export function ColumnsPanel({ open, onClose, columns, columnErrors, sampleRow, onChange }: Props) {
  const [building, setBuilding] = useState(false);
  const errorById = new Map(columnErrors.map((e) => [e.columnId, e.error]));

  const remove = (id: string) => {
    if (!confirm('Delete this column?')) return;
    onChange(columns.filter((c) => c.id !== id));
  };
  const add = (col: CustomColumnDefinition) => {
    onChange([...columns, col]);
    setBuilding(false);
  };

  return (
    <aside className={`fixed top-0 right-0 bottom-0 w-[380px] bg-bg-1 border-l border-line flex flex-col z-50 shadow-[-8px_0_24px_rgba(0,0,0,0.4)] transition-transform duration-300 ${
      open ? 'translate-x-0' : 'translate-x-full'
    }`}>
      <div className="flex items-center justify-between h-12 pl-4 pr-3 border-b border-line shrink-0">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Icon name="columns" size={15} className="text-accent" />
          <span>Custom columns</span>
          <span className="font-mono text-[10.5px] text-ink-3 font-normal ml-1">{columns.length} active</span>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition-colors">
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {columns.length === 0 && (
          <div className="flex flex-col items-center justify-center px-5 py-10 text-ink-3 text-center">
            <Icon name="flask" size={20} className="text-ink-4 mb-3" />
            <p className="m-0 mb-1.5 text-[12.5px]">No custom columns yet.</p>
            <p className="text-[11px] leading-[1.6] max-w-[240px]">
              Build columns from raw fields with expressions like{' '}
              <code className="bg-bg-3 px-1 py-px rounded font-mono text-[10px] text-codeblock">put_oi / call_oi</code>.
            </p>
          </div>
        )}
        {columns.map((c) => {
          const compiled = compileExpression(c.expression);
          const sample = compiled.ok && sampleRow ? compiled.evaluate(sampleRow) : null;
          const sampleValue = sample?.ok ? sample.value ?? null : null;
          const persistedError = errorById.get(c.id);
          const error = persistedError ?? compiled.error ?? sample?.error;
          const valid = !error;
          return (
            <ColumnCard
              key={c.id}
              col={c}
              valid={valid}
              error={error}
              sampleValue={sampleValue}
              deps={compiled.deps}
              isPreset={PRESET_IDS.has(c.id)}
              onDelete={() => remove(c.id)}
            />
          );
        })}
      </div>

      <div className="p-3 border-t border-line shrink-0">
        <PrimaryBtn onClick={() => setBuilding(true)} className="w-full">
          <Icon name="plus" size={14} /> New column
        </PrimaryBtn>
      </div>

      <Modal
        open={building}
        onClose={() => setBuilding(false)}
        title="New column"
        subtitle="expression · format"
        width={600}
      >
        <ColumnBuilder sampleRow={sampleRow} onCancel={() => setBuilding(false)} onCreate={add} />
      </Modal>
    </aside>
  );
}
