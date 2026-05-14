// Custom columns sidebar — lists, toggles, edits, deletes columns. Delegates
// add/edit to the ColumnBuilder modal. Delete with dependents goes through
// the ColumnDeleteModal which lists every rule + column that would break.
// Rename cascades: when the user changes a column's name, every reference
// to the old name in dependent rules + columns gets rewritten in place.

import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { PrimaryBtn } from './atoms';
import { fmtNum } from '../utils/format';
import { ColumnBuilder } from './ColumnBuilder';
import { ColumnDeleteModal } from './ColumnDeleteModal';
import {
  parseExpressionLoose, resolveColumnRefs, analyzeDependencies, evaluate,
} from '@tradl/shared';
import { findDependents } from '../core/column-deps';
import { rewriteIdent } from '../core/expression-rewrite';
import type {
  CustomColumnDefinition, OptionChainRow, RuleDefinition,
} from '../core/types';

interface CompiledExpr {
  ok: boolean;
  error?: string;
  deps: string[];
  evaluate: (row: OptionChainRow, snapshot: readonly OptionChainRow[]) => { ok: boolean; value?: number; error?: string };
}

function compileExpression(
  src: string,
  columnsByName: ReadonlyMap<string, CustomColumnDefinition>,
): CompiledExpr {
  try {
    const loose = parseExpressionLoose(src);
    const ast = resolveColumnRefs(loose, columnsByName);
    const deps = analyzeDependencies(ast).fields;
    return {
      ok: true,
      deps,
      evaluate: (row, snapshot) => {
        try {
          // The card preview's sample evaluation runs WITHOUT the engine's
          // `columnValues` table, so any column references will resolve to
          // NaN. That's fine for the small "≈ X" hint — full per-cell
          // computation happens in the worker.
          const v = evaluate(ast, row, { snapshot });
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

interface Props {
  open: boolean;
  onClose: () => void;
  columns: CustomColumnDefinition[];
  columnErrors: { columnId: string; error: string }[];
  /** Compile-time cycle errors from the engine. Surfaced as a banner. */
  cycleErrors?: string[];
  rows: readonly OptionChainRow[];
  onChange: (cols: CustomColumnDefinition[]) => void;
  /** Rules list (read-only) + setter so column rename can rewrite dependent
   *  rule expressions and delete-cascade can remove dependent rules. */
  rules?: RuleDefinition[];
  onRulesChange?: (rules: RuleDefinition[]) => void;
}

const PRESET_IDS = new Set(['col_pcr', 'col_str']);

export function ColumnsPanel({
  open, onClose, columns, columnErrors, cycleErrors, rows, onChange,
  rules = [], onRulesChange,
}: Props) {
  const [editing, setEditing] = useState<CustomColumnDefinition | null>(null);
  const [building, setBuilding] = useState(false);
  const [deleting, setDeleting] = useState<CustomColumnDefinition | null>(null);
  const errorById = new Map(columnErrors.map((e) => [e.columnId, e.error]));

  const columnsByName = useMemo(
    () => new Map(columns.map((c) => [c.name, c])),
    [columns],
  );

  const sampleRow = useMemo(
    () => (rows.length ? rows[Math.floor(rows.length / 2)] : undefined),
    [rows],
  );

  // Dependents for the column currently scheduled for deletion. Computed
  // every render; cheap because it walks at most a few rule/column ASTs.
  const deletingDependents = useMemo(() => {
    if (!deleting) return { rules: [], columns: [] };
    return findDependents(deleting.id, rules, columns);
  }, [deleting, rules, columns]);

  const confirmDelete = () => {
    if (!deleting) return;
    const id = deleting.id;
    const depIds = new Set<string>([
      ...deletingDependents.rules.map((r) => r.id),
      ...deletingDependents.columns.map((c) => c.id),
    ]);
    onChange(columns.filter((c) => c.id !== id && !depIds.has(c.id)));
    if (onRulesChange && deletingDependents.rules.length > 0) {
      onRulesChange(rules.filter((r) => !depIds.has(r.id)));
    }
  };

  const upsert = (col: CustomColumnDefinition) => {
    const idx = columns.findIndex((c) => c.id === col.id);
    if (idx < 0) {
      onChange([...columns, col]);
    } else {
      const prev = columns[idx];
      const renamed = prev.name !== col.name;
      let nextColumns = columns.map((c, i) => i === idx ? col : c);
      if (renamed) {
        // Cascade rename into dependent expressions. Rewrites only the
        // exact identifier token (not substrings or quoted strings).
        nextColumns = nextColumns.map((c) =>
          c.id === col.id
            ? c
            : { ...c, expression: rewriteIdent(c.expression, prev.name, col.name).source },
        );
        if (onRulesChange) {
          onRulesChange(rules.map((r) => ({
            ...r,
            expression: rewriteIdent(r.expression, prev.name, col.name).source,
          })));
        }
      }
      onChange(nextColumns);
    }
    setBuilding(false);
    setEditing(null);
  };

  // Other columns available to reference in the picker (when editing one,
  // exclude that one from the list to avoid suggesting self-reference).
  const pickerColumns = editing
    ? columns.filter((c) => c.id !== editing.id)
    : columns;

  return (
    <aside className={`fixed top-0 right-0 bottom-0 w-full sm:w-[380px] bg-bg-1 border-l border-line flex flex-col z-50 shadow-[-8px_0_24px_rgba(0,0,0,0.4)] transition-transform duration-300 ${
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
        {cycleErrors && cycleErrors.length > 0 && (
          <div className="mb-2 bg-pill-neg border border-pill-neg-border rounded px-2 py-1.5">
            <div className="font-mono text-[10px] text-neg uppercase tracking-[0.08em] mb-0.5">
              column cycle{cycleErrors.length === 1 ? '' : 's'}
            </div>
            {cycleErrors.map((c, i) => (
              <div key={i} className="font-mono text-[10.5px] text-neg">{c}</div>
            ))}
          </div>
        )}
        {columns.map((c) => {
          const compiled = compileExpression(c.expression, columnsByName);
          const sample = compiled.ok && sampleRow ? compiled.evaluate(sampleRow, rows) : null;
          const sampleValue = sample?.ok ? sample.value ?? null : null;
          const persistedError = errorById.get(c.id);
          const error = persistedError ?? compiled.error ?? sample?.error;
          const valid = !error;
          const isPreset = PRESET_IDS.has(c.id);
          return (
            <ColumnCard
              key={c.id}
              col={c}
              valid={valid}
              error={error}
              sampleValue={sampleValue}
              deps={compiled.deps}
              isPreset={isPreset}
              onEdit={() => setEditing(c)}
              onDelete={() => setDeleting(c)}
            />
          );
        })}
      </div>

      <div className="p-3 border-t border-line shrink-0">
        <PrimaryBtn onClick={() => setBuilding(true)} className="w-full">
          <Icon name="plus" size={14} /> New column
        </PrimaryBtn>
      </div>

      <ColumnBuilder
        open={building || editing !== null}
        onClose={() => { setBuilding(false); setEditing(null); }}
        initial={editing ?? undefined}
        rows={rows}
        customColumns={pickerColumns}
        onSave={upsert}
      />

      <ColumnDeleteModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        target={deleting}
        dependents={deletingDependents}
        onConfirm={confirmDelete}
      />
    </aside>
  );
}

function ColumnCard({ col, valid, error, sampleValue, deps, isPreset, onEdit, onDelete }: {
  col: CustomColumnDefinition;
  valid: boolean;
  error?: string;
  sampleValue: number | null;
  deps: string[];
  isPreset: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`bg-bg-2 rounded-lg py-2.5 px-3 mb-1.5 border ${valid ? 'border-line' : 'border-neg/60'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[12.5px] font-medium truncate flex items-baseline gap-1.5">
          {col.displayLabel ? (
            <>
              <span>{col.displayLabel}</span>
              <span className="font-mono text-[10px] text-ink-3">{col.name}</span>
            </>
          ) : (
            <span>{col.name}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isPreset && (
            <span className="font-mono text-[9.5px] bg-bg-3 text-ink-3 px-1.5 py-0.5 rounded uppercase tracking-[0.06em] mr-1">preset</span>
          )}
          <button onClick={onEdit} className="bg-transparent border-0 text-ink-3 p-0.5 rounded hover:text-ink hover:bg-bg-3" title="Edit">
            <Icon name="edit" size={12} />
          </button>
          <button onClick={onDelete} className="bg-transparent border-0 text-ink-3 p-0.5 rounded hover:text-neg hover:bg-bg-3" title="Delete">
            <Icon name="trash" size={12} />
          </button>
        </div>
      </div>
      <code className="block bg-bg-1 border border-line px-2 py-1.5 rounded font-mono text-[11px] text-codeblock break-all mb-1.5">{col.expression}</code>
      <div className="flex justify-between font-mono text-[10.5px]">
        <span className="text-ink-3">{deps.length ? deps.join(' · ') : 'no fields'}</span>
        {valid ? (
          <span className="text-pos">~{fmtNum(sampleValue, 2)}</span>
        ) : (
          <span className="text-neg truncate ml-2">{error}</span>
        )}
      </div>
    </div>
  );
}

