import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Dropdown } from './Dropdown';
import { Kbd, ToolbarButton } from './atoms';
import { fmtChange, fmtCompact, fmtNum, timeAgo } from '../utils/format';
import { NEXT_THEME, THEME_LABELS, useTheme, type Theme } from '../hooks/useTheme';

interface ConnDotProps {
  connected: boolean;
  lastUpdate: number;
}

function ConnectionDot({ connected, lastUpdate }: ConnDotProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-1.5 pr-1">
      <span
        className={`w-[7px] h-[7px] rounded-full ${connected ? 'bg-pos animate-pulse-soft shadow-[0_0_8px_#4ade80]' : 'bg-neg'}`}
      />
      <span className="font-mono text-[10.5px] text-ink-3 uppercase tracking-[0.06em]">
        {connected ? 'live' : 'offline'} · {timeAgo(Date.now() - lastUpdate)}
      </span>
    </div>
  );
}

interface Props<S extends string> {
  symbol: S;
  symbols: readonly S[];
  setSymbol: (s: S) => void;
  expiry: string;
  setExpiry: (e: string) => void;
  expiries: string[];
  spot: number;
  spotChange: number;
  spotPct: number;
  rulesOpen: boolean;
  columnsOpen: boolean;
  onToggleRules: () => void;
  onToggleColumns: () => void;
  ruleCount: number;
  columnCount: number;
  lastUpdate: number;
  connected: boolean;
  totalVolume: number;
  totalOI: number;
  panelOpen: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAsk: () => void;
}

export function Header<S extends string>({
  symbol, symbols, setSymbol, expiry, setExpiry, expiries,
  spot, spotChange, spotPct,
  rulesOpen, columnsOpen, onToggleRules, onToggleColumns,
  ruleCount, columnCount, lastUpdate, connected, totalVolume, totalOI,
  panelOpen, expanded, onToggleExpanded, onAsk,
}: Props<S>) {
  const [theme, setTheme] = useTheme();
  const next: Theme = NEXT_THEME[theme];
  return (
    <header className={`flex items-center justify-between h-12 pl-3.5 ${panelOpen ? 'pr-[394px]' : 'pr-3.5'} gap-4 bg-bg-1 border-b border-line flex-shrink-0 transition-[padding] duration-300`}>
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-1.5 mr-1">
          <span className="text-accent text-base leading-none">▰</span>
          <span className="font-mono text-[12.5px] tracking-[-0.01em] font-semibold">
            <span className="font-mono">tradl</span>
            <span className="text-ink-3 font-normal">/option-chain</span>
          </span>
        </div>
        <Dropdown value={symbol} options={symbols} onChange={setSymbol} width={120} />
        <Dropdown value={expiry} options={expiries.length ? expiries : [expiry]} onChange={setExpiry} label="exp" width={150} />
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10.5px] text-ink-3 uppercase tracking-[0.08em]">spot</span>
          <span className="font-mono text-base font-semibold tnum tracking-[-0.01em]">{fmtNum(spot)}</span>
          <span className={`font-mono text-xs tnum ${spotChange >= 0 ? 'text-pos' : 'text-neg'}`}>
            {fmtChange(spotChange)} <span className="opacity-75 text-[11px]">({fmtChange(spotPct)}%)</span>
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">vol</span>
          <span className="font-mono text-xs tnum text-ink-2">{fmtCompact(totalVolume)}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">oi</span>
          <span className="font-mono text-xs tnum text-ink-2">{fmtCompact(totalOI)}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ConnectionDot connected={connected} lastUpdate={lastUpdate} />
        <ToolbarButton onClick={onAsk} title="Ask AI to add a rule or column">
          <span className="text-accent leading-none">✦</span>
          <span>Ask</span>
          <Kbd>/</Kbd>
        </ToolbarButton>
        <ToolbarButton active={rulesOpen} onClick={onToggleRules}>
          <Icon name="bolt" size={14} />
          <span>Rules</span>
          <CountBadge active={rulesOpen}>{ruleCount}</CountBadge>
        </ToolbarButton>
        <ToolbarButton active={columnsOpen} onClick={onToggleColumns}>
          <Icon name="columns" size={14} />
          <span>Columns</span>
          <CountBadge active={columnsOpen}>{columnCount}</CountBadge>
        </ToolbarButton>
        <button
          title={`Theme: ${THEME_LABELS[theme]} — click for ${THEME_LABELS[next]}`}
          onClick={() => setTheme(next)}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-ink-3 hover:bg-bg-2 hover:text-ink transition-colors border border-transparent"
        >
          <ThemeIcon theme={theme} />
          <span className="font-mono text-[10px] uppercase tracking-[0.06em]">{THEME_LABELS[theme]}</span>
        </button>

        <button
          title={expanded ? 'Hide Vol & IV columns' : 'Show Vol & IV columns'}
          onClick={onToggleExpanded}
          className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium transition-colors border ${
            expanded
              ? 'bg-bg-3 text-ink border-line-2'
              : 'bg-transparent text-ink-3 border-transparent hover:bg-bg-2 hover:text-ink'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {expanded ? (
              <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M15 6l-6 6 6 6M9 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
            )}
          </svg>
          <span className="font-mono text-[10px] uppercase tracking-[0.06em]">{expanded ? 'Wide' : 'Slim'}</span>
        </button>
        <button
          title="Settings"
          className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition-colors border border-transparent"
        >
          <Icon name="settings" size={15} />
        </button>
        <button
          title="Account"
          className="w-7 h-7 rounded-md flex items-center justify-center font-mono text-[11px] font-semibold bg-bg-3 text-ink border border-line-2"
        >
          A
        </button>
      </div>
    </header>
  );
}

function CountBadge({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded min-w-[16px] text-center ${
      active ? 'bg-accent text-black font-semibold' : 'bg-bg-3 text-ink-2'
    }`}>
      {children}
    </span>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  switch (theme) {
    case 'paper':
      // Page corner — warm light surface
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" opacity="0.6" />
        </svg>
      );
    case 'frost':
      // Snowflake — pure white surface
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 2v20M4 6l16 12M4 18L20 6" strokeLinecap="round" />
        </svg>
      );
    case 'terminal':
      // Chevron prompt
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M5 7l4 5-4 5M12 17h7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'clean':
    default:
      // Half-circle — neutral
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18" opacity="0.5" />
        </svg>
      );
  }
}
