import { useMemo } from 'react';
import { GhostBtn, Kbd, PrimaryBtn, StatePill } from '../../atoms';
import { ConfidenceBar, WarningBanner } from '../atoms';
import { ConditionChips } from '../../ConditionChips';
import { ruleFromAi, type AIParseResult } from '../../../services/aiParse';
import { dryRunRule, type DryRunRule } from '../../../services/aiPreview';
import type { OptionChainRow } from '../../../core/types';

interface Props {
  result: AIParseResult;
  rows: OptionChainRow[];
  onApply: () => void;
  onEditJson: () => void;
  onRephrase: () => void;
}

export function RulePreview({ result, rows, onApply, onEditJson, onRephrase }: Props) {
  const r = result.rule!;
  const isLow = result.confidence < 0.7;

  // Build a temp RuleDefinition to dry-run against current rows.
  const dryRun: DryRunRule = useMemo(() => dryRunRule(ruleFromAi(r, 195), rows), [r, rows]);

  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-3">
        <StatePill tone="accent">◆ Rule</StatePill>
        <span className="text-[13px] font-medium truncate">{r.name}</span>
        <span className="ml-auto"><ConfidenceBar value={result.confidence} /></span>
      </div>

      {isLow && (
        <WarningBanner
          heading="Best guess."
          body="The model wasn't fully sure. Verify the conditions below before applying — or rephrase with a specific field/threshold."
        />
      )}

      <div className="text-[11.5px] text-ink-2 mb-3 leading-[1.5]">{r.description}</div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3 bg-bg-1 border border-line rounded-lg p-2.5">
        <ConditionChips conditions={r.conditions} logic={r.logic} />
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[11px] text-ink-3">
          highlight on <span className="text-ink-2">{r.scope}</span>
          {dryRun.error ? (
            <span className="ml-2 text-neg">{dryRun.error}</span>
          ) : dryRun.total > 0 ? (
            <> · matches{' '}
              <span className={`font-semibold ${dryRun.matches > 0 ? 'text-pos' : 'text-ink-2'}`}>
                {dryRun.matches}
              </span>
              <span className="text-ink-2">/{dryRun.total}</span>{' '}strikes
            </>
          ) : null}
        </div>
        {!dryRun.error && dryRun.total > 0 && (
          <div className="h-1.5 w-24 bg-bg-3 rounded-full overflow-hidden">
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
