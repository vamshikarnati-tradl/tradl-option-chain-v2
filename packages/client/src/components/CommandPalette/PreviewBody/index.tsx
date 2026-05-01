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
}

export function PreviewBody({ result, rows, onApply, onEditJson, onPickOption, onRephrase }: Props) {
  if (result.intent === 'ambiguous' && result.options) {
    return <AmbiguousView confidence={result.confidence} options={result.options} onPick={onPickOption} />;
  }
  if (result.intent === 'rule' && result.rule) {
    return (
      <RulePreview
        result={result}
        rows={rows}
        onApply={() => onApply('rule')}
        onEditJson={onEditJson}
        onRephrase={onRephrase}
      />
    );
  }
  if (result.intent === 'column' && result.column) {
    return (
      <ColumnPreview
        result={result}
        rows={rows}
        onApply={() => onApply('column')}
        onEditJson={onEditJson}
        onRephrase={onRephrase}
      />
    );
  }
  return null;
}
