import { AmbiguousView } from './AmbiguousView';
import { RulePreview } from './RulePreview';
import { ColumnPreview } from './ColumnPreview';
import type { AIParseResult, AmbiguousOption } from '../../../services/aiParse';
import type { OptionChainRow } from '../../../core/types';

interface Props {
  result: AIParseResult;
  rows: OptionChainRow[];
  onApply: (intent: 'rule' | 'column') => void;
  onEditJson: () => void;
  onPickOption: (opt: AmbiguousOption) => void;
  onRephrase: () => void;
  refineValue: string;
  onRefineChange: (s: string) => void;
  onRefineSubmit: () => void;
  isRefining: boolean;
}

export function PreviewBody({
  result, rows, onApply, onEditJson, onPickOption, onRephrase,
  refineValue, onRefineChange, onRefineSubmit, isRefining,
}: Props) {
  if (result.intent === 'ambiguous' && result.options) {
    return <AmbiguousView confidence={result.confidence} options={result.options} onPick={onPickOption} />;
  }
  if (result.intent === 'rule' && result.rule) {
    return (
      <>
        <RulePreview
          result={result}
          rows={rows}
          onApply={() => onApply('rule')}
          onEditJson={onEditJson}
          onRephrase={onRephrase}
        />
        <RefineInput
          value={refineValue}
          onChange={onRefineChange}
          onSubmit={onRefineSubmit}
          isRefining={isRefining}
        />
      </>
    );
  }
  if (result.intent === 'column' && result.column) {
    return (
      <>
        <ColumnPreview
          result={result}
          rows={rows}
          onApply={() => onApply('column')}
          onEditJson={onEditJson}
          onRephrase={onRephrase}
        />
        <RefineInput
          value={refineValue}
          onChange={onRefineChange}
          onSubmit={onRefineSubmit}
          isRefining={isRefining}
        />
      </>
    );
  }
  return null;
}

interface RefineProps {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  isRefining: boolean;
}

function RefineInput({ value, onChange, onSubmit, isRefining }: RefineProps) {
  return (
    <div className="px-4 py-3 border-t border-line bg-bg-1/40">
      <div className="flex items-center gap-2">
        <span className="text-ink-3 text-[11px] font-mono uppercase tracking-[0.08em] shrink-0">refine</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (value.trim() && !isRefining) onSubmit();
            }
          }}
          placeholder="not quite — describe what to change…"
          disabled={isRefining}
          className="flex-1 bg-bg-2 border border-line rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-line-2 placeholder:text-ink-4 disabled:opacity-50"
        />
      </div>
    </div>
  );
}
