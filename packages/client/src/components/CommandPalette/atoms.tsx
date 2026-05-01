// CommandPalette-internal atoms. Things small/specific enough that they don't
// belong in the shared atoms folder.

export function ParsingDots() {
  return (
    <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] inline-flex items-center gap-1.5">
      <span className="w-1 h-1 rounded-full bg-accent animate-pulse-soft" />
      <span className="w-1 h-1 rounded-full bg-accent animate-pulse-soft" style={{ animationDelay: '160ms' }} />
      <span className="w-1 h-1 rounded-full bg-accent animate-pulse-soft" style={{ animationDelay: '320ms' }} />
      <span className="ml-0.5">parsing</span>
    </span>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round((value || 0) * 100);
  const tone = value >= 0.8 ? 'pos' : value >= 0.6 ? 'warn' : 'neg';
  const barColor = tone === 'pos' ? '#4ade80' : tone === 'warn' ? 'hsl(45,90%,60%)' : '#f87171';
  return (
    <div className="flex items-center gap-1.5" title={`Model confidence: ${pct}%`}>
      <div className="h-1 w-10 bg-bg-3 rounded-full overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <span className="font-mono text-[10px] text-ink-3">{pct}%</span>
    </div>
  );
}

export function WarningBanner({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex items-start gap-2 mb-3 bg-warn-banner border border-warn-banner-border rounded-lg px-3 py-2">
      <span className="text-warning mt-px text-[13px] leading-none">⚠</span>
      <div className="flex-1 text-[11.5px] text-warning leading-[1.5]">
        <span className="font-medium">{heading}</span>
        <span> {body}</span>
      </div>
    </div>
  );
}
