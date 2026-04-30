import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Dropdown } from './Dropdown';
import { fmtChange, fmtCompact, fmtNum, timeAgo } from '../utils/format';
import { useTheme } from '../hooks/useTheme';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

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

interface Props {
  symbol: string;
  setSymbol: (s: string) => void;
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
}

export function Header({
  symbol, setSymbol, expiry, setExpiry, expiries,
  spot, spotChange, spotPct,
  rulesOpen, columnsOpen, onToggleRules, onToggleColumns,
  ruleCount, columnCount, lastUpdate, connected, totalVolume, totalOI,
  panelOpen,
}: Props) {
  const [theme, setTheme] = useTheme();
  return (
    <header className={`flex items-center justify-between h-12 pl-3.5 ${panelOpen ? 'pr-[394px]' : 'pr-3.5'} gap-4 bg-bg-1 border-b border-line flex-shrink-0 transition-[padding] duration-300`}>
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-1.5 mr-1">
          <span className="text-accent text-base leading-none">▰</span>
          <span className="font-mono text-[12.5px] tracking-[-0.01em] font-semibold">
            tradr<span className="text-ink-3 font-normal">/option-chain</span>
          </span>
        </div>
        <Dropdown value={symbol} options={SYMBOLS} onChange={setSymbol} width={120} />
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
        <button
          onClick={onToggleRules}
          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-all ${
            rulesOpen
              ? 'bg-bg-3 text-ink border-accent'
              : 'bg-transparent text-ink-2 border-line-2 hover:bg-bg-2 hover:text-ink'
          }`}
        >
          <Icon name="bolt" size={14} />
          <span>Rules</span>
          <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded min-w-[16px] text-center ${
            rulesOpen ? 'bg-accent text-black font-semibold' : 'bg-bg-3 text-ink-2'
          }`}>
            {ruleCount}
          </span>
        </button>
        <button
          onClick={onToggleColumns}
          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-all ${
            columnsOpen
              ? 'bg-bg-3 text-ink border-accent'
              : 'bg-transparent text-ink-2 border-line-2 hover:bg-bg-2 hover:text-ink'
          }`}
        >
          <Icon name="columns" size={14} />
          <span>Columns</span>
          <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded min-w-[16px] text-center ${
            columnsOpen ? 'bg-accent text-black font-semibold' : 'bg-bg-3 text-ink-2'
          }`}>
            {columnCount}
          </span>
        </button>
        <button
          title={theme === 'glass' ? 'Switch to Terminal theme' : 'Switch to Glass theme'}
          onClick={() => setTheme(theme === 'glass' ? 'terminal' : 'glass')}
          className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition-colors border border-transparent"
        >
          {theme === 'glass' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 3l8 5-8 5-8-5 8-5z" />
              <path d="M4 13l8 5 8-5" opacity="0.6" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M5 7l4 5-4 5M12 17h7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
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
