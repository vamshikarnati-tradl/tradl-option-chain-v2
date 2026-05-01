import { StatePill } from '../atoms';
import { SUGGESTIONS } from './types';

interface Props {
  message: string;
  onPick: (s: string) => void;
}

export function ErrorBody({ message, onPick }: Props) {
  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-2.5">
        <StatePill tone="neg">! Error</StatePill>
        <span className="text-[12.5px] text-ink-2">Couldn't parse that</span>
      </div>
      <div className="text-[11.5px] text-ink-3 leading-[1.5] mb-3">
        {message}. Try one of the examples below, or rephrase using a field name like{' '}
        <span className="font-mono text-ink-2">call_oi</span> or <span className="font-mono text-ink-2">put_iv</span>.
      </div>
      <div className="flex flex-col gap-1">
        {SUGGESTIONS.slice(0, 3).map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-[11.5px] text-ink-3 px-2.5 py-1.5 rounded hover:bg-bg-2 hover:text-ink-2 transition-colors flex items-center gap-2"
          >
            <span className="text-ink-4">→</span>
            <span>{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
