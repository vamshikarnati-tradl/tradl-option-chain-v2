import { SUGGESTIONS } from './types';
import type { RecentEntry } from '../../services/aiHistory';

interface Props {
  recent: RecentEntry[];
  onPick: (s: string) => void;
  onPickRecent: (e: RecentEntry) => void;
}

export function IdleBody({ recent, onPick, onPickRecent }: Props) {
  return (
    <div className="px-4 py-4">
      <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-2">Try</div>
      <div className="flex flex-col gap-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-[12.5px] text-ink-2 px-2.5 py-1.5 rounded hover:bg-bg-2 hover:text-ink transition-colors flex items-center gap-2 group"
          >
            <span className="text-ink-4 group-hover:text-accent transition-colors">→</span>
            <span>{s}</span>
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mt-3 mb-2">Recent</div>
          <div className="flex flex-col gap-0.5">
            {recent.map((h) => (
              <button
                key={`${h.query}-${h.ts}`}
                onClick={() => onPickRecent(h)}
                className="text-left text-[11.5px] text-ink-3 px-2.5 py-1 rounded hover:bg-bg-2 hover:text-ink-2 transition-colors flex items-center gap-2"
              >
                <span className="text-ink-4">{h.intent === 'rule' ? '◆' : 'ƒ'}</span>
                <span className="truncate">{h.query}</span>
                <span className="ml-auto text-ink-4 font-mono text-[10px] truncate">{h.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
