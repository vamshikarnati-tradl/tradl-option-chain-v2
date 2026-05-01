import { StatePill } from '../../atoms';
import { ConfidenceBar } from '../atoms';
import type { AmbiguousOption } from '../../../services/aiParse';

interface Props {
  confidence: number;
  options: AmbiguousOption[];
  onPick: (opt: AmbiguousOption) => void;
}

export function AmbiguousView({ confidence, options, onPick }: Props) {
  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-3">
        <StatePill tone="warn">? Ambiguous</StatePill>
        <span className="text-[12.5px] text-ink-2">What did you mean?</span>
        <span className="ml-auto"><ConfidenceBar value={confidence} /></span>
      </div>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.label}
            onClick={() => onPick(opt)}
            className="text-left flex items-start gap-3 bg-bg-1 hover:bg-bg-2 border border-line hover:border-line-2 rounded-lg px-3 py-2.5 transition-colors"
          >
            <span className={`mt-0.5 ${opt.intent === 'rule' ? 'text-accent' : 'text-multiplier'}`}>
              {opt.intent === 'rule' ? '◆' : 'ƒ'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium">{opt.label}</div>
              <div className="text-[11px] text-ink-3 leading-[1.4] mt-0.5">{opt.description}</div>
            </div>
            <span className="text-ink-3 mt-0.5">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
