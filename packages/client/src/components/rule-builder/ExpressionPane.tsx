// Shared expression editor pane — used by both Rule Builder and Column
// Builder. Owns the mode toggle (Expression / Visual), the pretty toggle
// (one-line / multi-line), the textarea editor + syntax highlight overlay,
// the Visual Mode pill renderer, the LLM refine input, and the parse status
// row. The only kind-specific behavior threaded through is `kind` — drives
// the refine endpoint's prompt + validation.

import { Icon } from '../Icon';
import { ExpressionEditor } from './ExpressionEditor';
import { ExpressionView, type LiteralRange } from './ExpressionView';
import { RefineWithAI } from './RefineWithAI';
import { formatExpr, formatExprMultiline } from '@tradl/shared';
import { useRuleBuilderPrefs } from '../../hooks/useRuleBuilderPrefs';
import type { ParsedExpression } from './useExpressionParse';
import type { CustomColumnDefinition } from '../../core/types';

interface Props {
  expression: string;
  onExpressionChange: (next: string) => void;
  parsed: ParsedExpression;
  kind: 'rule' | 'column';
  /** Char range of the currently bound slider literal, if any. Rules use it;
   *  columns leave it undefined. */
  activeLiteralRange?: LiteralRange | null;
  /** Click-on-literal handler. Rules wire it to the slider; columns leave it
   *  off (no slider in column builder). */
  onLiteralClick?: (range: LiteralRange) => void;
  /** Live columns — names matching identifiers in the source get the
   *  column-ref token color in Expression Mode. */
  availableColumns?: readonly CustomColumnDefinition[];
}

export function ExpressionPane({
  expression, onExpressionChange, parsed, kind,
  activeLiteralRange, onLiteralClick, availableColumns,
}: Props) {
  const { prefs, setMode, setPretty } = useRuleBuilderPrefs();
  const { mode, pretty } = prefs;

  const togglePretty = () => {
    if (!parsed.ok || !parsed.ast) return;
    const next = pretty === 'oneLine' ? 'multiLine' : 'oneLine';
    onExpressionChange(next === 'multiLine'
      ? formatExprMultiline(parsed.ast)
      : formatExpr(parsed.ast));
    setPretty(next);
  };

  return (
    <div>
      {/* Mode toggle + pretty toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="inline-flex bg-bg-1 border border-line rounded p-0.5">
          <button
            onClick={() => setMode('expression')}
            className={`px-2.5 py-1 text-[11px] rounded uppercase tracking-[0.04em] transition-colors ${
              mode === 'expression' ? 'bg-bg-3 text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            Expression
          </button>
          <button
            onClick={() => setMode('visual')}
            className={`px-2.5 py-1 text-[11px] rounded uppercase tracking-[0.04em] transition-colors ${
              mode === 'visual' ? 'bg-bg-3 text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            Visual
          </button>
        </div>
        {mode === 'expression' && (
          <button
            onClick={togglePretty}
            disabled={!parsed.ok}
            className="inline-flex items-center gap-1 bg-bg-1 border border-line text-ink-3 text-[10.5px] px-2 py-0.5 rounded hover:text-ink hover:border-line-2 disabled:opacity-50"
          >
            {pretty === 'oneLine' ? 'one-line' : 'multi-line'}
          </button>
        )}
      </div>

      {/* Editor — text mode OR visual mode */}
      {mode === 'expression' ? (
        <ExpressionEditor
          value={expression}
          onChange={onExpressionChange}
          errorPos={parsed.errorPos ?? null}
          activeLiteralRange={activeLiteralRange ?? null}
          onLiteralClick={onLiteralClick}
          rows={pretty === 'multiLine' ? 8 : 3}
          availableColumns={availableColumns}
          placeholder={kind === 'rule'
            ? 'e.g. call_oi > 80000  |  put_oi / call_oi > 1.5'
            : 'e.g. put_oi / call_oi  |  abs(call_iv - put_iv)'}
        />
      ) : parsed.ok && parsed.ast ? (
        <div className="expr-view-wrapper">
          <ExpressionView
            ast={parsed.ast}
            activeLiteral={activeLiteralRange ?? null}
            onLiteralClick={onLiteralClick}
          />
          <RefineWithAI
            currentExpression={expression}
            onApply={onExpressionChange}
            kind={kind}
          />
        </div>
      ) : (
        <div className="bg-bg-1 border border-line rounded-md p-3 text-[11.5px] text-ink-3 italic">
          Write a valid expression to see the visual breakdown.
        </div>
      )}

      {/* Status row */}
      <div className={`mt-2 flex items-center gap-1.5 font-mono text-[10.5px] px-2 py-1 rounded ${
        parsed.ok ? 'bg-pill-pos text-pos' : parsed.error ? 'bg-pill-neg text-neg' : 'bg-bg-1 text-ink-4'
      }`}>
        {parsed.ok ? (
          <>
            <Icon name="check" size={12} />
            <span className="truncate">
              parsed · uses {parsed.deps?.join(', ') || '(no fields)'}
              {parsed.isTimeAware && ' · time-aware'}
              {parsed.needsSnapshot && ' · cross-strike'}
              {parsed.isHistorical && ' · historical (deferred)'}
            </span>
          </>
        ) : parsed.error ? (
          <>
            <Icon name="x" size={12} />
            <span className="truncate">{parsed.error}</span>
          </>
        ) : (
          <span>Write an expression to begin.</span>
        )}
      </div>
    </div>
  );
}
