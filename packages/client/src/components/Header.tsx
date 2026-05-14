import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Dropdown } from './Dropdown';
import { Kbd, ToolbarButton } from './atoms';
import { fmtChange, fmtCompact, fmtNum, timeAgo } from '../utils/format';
import { NEXT_THEME, THEME_LABELS, useTheme, type Theme } from '../hooks/useTheme';
import type { SnapshotSource } from '../core/types';

function MockBadge() {
  return (
    <span
      title="The TRADL gateway is unreachable — showing simulated mock data. Live data will resume automatically when the gateway recovers."
      className="inline-flex items-center gap-1 h-5 px-1.5 rounded border border-pill-neg-border bg-pill-neg text-neg font-mono text-[10px] uppercase tracking-[0.08em]"
    >
      <span className="w-[5px] h-[5px] rounded-full bg-neg" />
      mock
    </span>
  );
}

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
  source: SnapshotSource | null;
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
  rulesOpen, columnsOpen,
  onToggleRules, onToggleColumns,
  ruleCount, columnCount,
  lastUpdate, connected, source, totalVolume, totalOI,
  panelOpen, expanded, onToggleExpanded, onAsk,
}: Props<S>) {
  const [theme, setTheme] = useTheme();
  const next: Theme = NEXT_THEME[theme];
  return (
    <header className={`flex items-center justify-between h-12 pl-2 sm:pl-3.5 ${panelOpen ? 'pr-2 sm:pr-[394px]' : 'pr-2 sm:pr-3.5'} gap-1 sm:gap-4 bg-bg-1 border-b border-line flex-shrink-0 transition-[padding] duration-300`}>
      {/* Brand + symbol/expiry */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        <div className="hidden md:flex items-baseline gap-1.5 mr-1 shrink-0">
          <span className="text-accent text-base leading-none">▰</span>
          <span className="font-mono text-[12.5px] tracking-[-0.01em] font-semibold whitespace-nowrap">
            <span className="font-mono">tradl</span>
            <span className="text-ink-3 font-normal">/option-chain</span>
          </span>
        </div>
        {/* Mobile-only mark */}
        <span className="md:hidden text-accent text-base leading-none shrink-0">▰</span>
        <Dropdown value={symbol} options={symbols} onChange={setSymbol} width={120} mobileWidth={86} />
        <Dropdown value={expiry} options={expiries.length ? expiries : [expiry]} onChange={setExpiry} label="exp" width={150} mobileWidth={104} hideLabelOnMobile />
      </div>

      {/* Spot + vol/oi (vol/oi hidden until xl, vol+oi labels hidden until sm).
          Spot block can shrink so chrome buttons stay on screen. */}
      <div className="flex items-center gap-3 sm:gap-6 min-w-0 shrink">
        <div className="flex items-baseline gap-1 sm:gap-2 min-w-0">
          <span className="hidden sm:inline font-mono text-[10.5px] text-ink-3 uppercase tracking-[0.08em]">spot</span>
          <span className="font-mono text-sm sm:text-base font-semibold tnum tracking-[-0.01em] truncate">{fmtNum(spot)}</span>
          <span className={`font-mono text-[11px] sm:text-xs tnum truncate ${spotChange >= 0 ? 'text-pos' : 'text-neg'}`}>
            <span className="hidden sm:inline">{fmtChange(spotChange)} </span>
            <span className="opacity-90 sm:opacity-75 text-[10.5px] sm:text-[11px]">({fmtChange(spotPct)}%)</span>
          </span>
        </div>
        <div className="hidden xl:flex items-baseline gap-1.5">
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">vol</span>
          <span className="font-mono text-xs tnum text-ink-2">{fmtCompact(totalVolume)}</span>
        </div>
        <div className="hidden xl:flex items-baseline gap-1.5">
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">oi</span>
          <span className="font-mono text-xs tnum text-ink-2">{fmtCompact(totalOI)}</span>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 sm:gap-3 shrink-0">
        {source === 'mock' && <MockBadge />}
        <div className="hidden md:flex"><ConnectionDot connected={connected} lastUpdate={lastUpdate} /></div>
        {/* Mobile-only: just a pulsing dot */}
        <span className={`md:hidden w-[7px] h-[7px] rounded-full ${connected ? 'bg-pos animate-pulse-soft' : 'bg-neg'}`} />
        <ToolbarButton onClick={onAsk} title="Ask AI to add a rule or column" className="hidden md:inline-flex">
          <span className="text-accent leading-none">✦</span>
          <span>Ask</span>
          <Kbd>/</Kbd>
        </ToolbarButton>
        <ToolbarButton active={rulesOpen} onClick={onToggleRules} className="hidden md:inline-flex">
          <Icon name="bolt" size={14} />
          <span className="hidden sm:inline">Rules</span>
          <CountBadge active={rulesOpen}>{ruleCount}</CountBadge>
        </ToolbarButton>
        <ToolbarButton active={columnsOpen} onClick={onToggleColumns} className="hidden md:inline-flex">
          <Icon name="columns" size={14} />
          <span className="hidden sm:inline">Columns</span>
          <CountBadge active={columnsOpen}>{columnCount}</CountBadge>
        </ToolbarButton>
        <button
          title={`Theme: ${THEME_LABELS[theme]} — click for ${THEME_LABELS[next]}`}
          onClick={() => setTheme(next)}
          className="hidden md:inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-ink-3 hover:bg-bg-2 hover:text-ink transition-colors border border-transparent"
        >
          <ThemeIcon theme={theme} />
          <span className="font-mono text-[10px] uppercase tracking-[0.06em]">{THEME_LABELS[theme]}</span>
        </button>

        <button
          title={expanded ? 'Hide Vol & IV columns' : 'Show Vol & IV columns'}
          onClick={onToggleExpanded}
          className={`hidden md:inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium transition-colors border ${
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
