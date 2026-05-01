type Tone = 'neutral' | 'pos' | 'warn' | 'neg' | 'accent';

interface Props {
  children: React.ReactNode;
  tone?: Tone;
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-bg-3 text-ink-2 border-line-2',
  pos: 'bg-pill-pos text-pos border-pill-pos-border',
  warn: 'bg-pill-warn text-warning border-pill-warn-border',
  neg: 'bg-pill-neg text-neg border-pill-neg-border',
  accent: 'bg-pill-accent text-accent border-pill-accent-border',
};

export function StatePill({ children, tone = 'neutral' }: Props) {
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded border ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
