import { useMemo } from 'react';
import { GhostBtn, Kbd, PrimaryBtn, StatePill } from '../../atoms';
import { ConfidenceBar, WarningBanner } from '../atoms';
import { ExpressionView } from '../../rule-builder/ExpressionView';
import { ruleFromAi, type AIParseResult } from '../../../services/aiParse';
import { dryRunRule, type DryRunRule } from '../../../services/aiPreview';
import { compileRule } from '../../../core/rule-engine';
import { parseAndResolve } from '../../../core/parse-and-resolve';
import { type Expr } from '@tradl/shared';
import type { CustomColumnDefinition, OptionChainRow } from '../../../core/types';

interface Props {
  result: AIParseResult;
  rows: OptionChainRow[];
  /** Live saved columns — used to resolve `maxPain`-style identifiers in
   *  an AI-generated rule expression. The model knows about user columns
   *  (see the server prompt nudge) and may reference them by name. */
  columns: CustomColumnDefinition[];
  onApply: () => void;
  onEditJson: () => void;
  onRephrase: () => void;
}

export function RulePreview({ result, rows, columns, onApply, onEditJson, onRephrase }: Props) {
  const r = result.rule!;
  const isLow = result.confidence < 0.7;

  const { def, ast, dryRun, affectedFields } = useMemo(() => {
    const d = ruleFromAi(r, 195);
    const columnsByName = new Map(columns.map((c) => [c.name, c]));
    let deps: string[] = [];
    try { deps = compileRule(d, columnsByName).deps; } catch { /* surfaced via dryRun.error */ }
    let parsedAst: Expr | null = null;
    try { parsedAst = parseAndResolve(d.expression, columns); } catch { /* dryRun.error covers it */ }
    return {
      def: d,
      ast: parsedAst,
      dryRun: dryRunRule(d, rows, columns) as DryRunRule,
      affectedFields: deps,
    };
  }, [r, rows, columns]);

  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-3">
        <StatePill tone="accent">◆ Rule</StatePill>
        <span className="text-[13px] font-medium truncate">{def.name}</span>
        {result.repaired && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-ink-3 bg-bg-3"
            title="The model's first draft failed validation. The server prompted it once more to fix the issue."
          >
            ↻ auto-corrected
          </span>
        )}
        <span className="ml-auto"><ConfidenceBar value={result.confidence} /></span>
      </div>

      {isLow && (
        <WarningBanner
          heading="Best guess."
          body="The model wasn't fully sure. Verify the expression below before applying — or rephrase with a specific field/threshold."
        />
      )}

      {def.description && (
        <div className="text-[11.5px] text-ink-2 mb-3 leading-[1.5]">{def.description}</div>
      )}

      <div className="bg-bg-1 border border-line rounded-lg p-3 mb-3">
        {ast ? (
          <ExpressionView ast={ast} compact />
        ) : (
          <code className="font-mono text-[11.5px] text-codeblock">{def.expression}</code>
        )}
      </div>

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="font-mono text-[11px] text-ink-3 min-w-0">
          {affectedFields.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-ink-3">tints</span>
              {affectedFields.map((f) => (
                <span key={f} className="px-1.5 py-0.5 rounded bg-bg-3 text-ink-2 text-[10.5px]">{f}</span>
              ))}
            </div>
          ) : (
            <span>no cells affected</span>
          )}
          {dryRun.error ? (
            <div className="mt-1 text-neg">{dryRun.error}</div>
          ) : dryRun.total > 0 ? (
            <div className="mt-1">matches{' '}
              <span className={`font-semibold ${dryRun.matches > 0 ? 'text-pos' : 'text-ink-2'}`}>
                {dryRun.matches}
              </span>
              <span className="text-ink-2">/{dryRun.total}</span>{' '}strikes
            </div>
          ) : null}
        </div>
        {!dryRun.error && dryRun.total > 0 && (
          <div className="h-1.5 w-24 mt-1 shrink-0 bg-bg-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-pos/80 transition-all"
              style={{ width: `${Math.max(2, (dryRun.matches / dryRun.total) * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-1.5 justify-end">
        {isLow && <GhostBtn onClick={onRephrase}>Rephrase</GhostBtn>}
        <GhostBtn onClick={onEditJson}>{'</> Edit JSON'}</GhostBtn>
        <PrimaryBtn onClick={onApply}>
          ✓ Apply rule <Kbd size="xs" className="hidden md:inline-block">↵</Kbd>
        </PrimaryBtn>
      </div>
    </div>
  );
}
