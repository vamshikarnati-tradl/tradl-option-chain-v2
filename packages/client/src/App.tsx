import { useEffect, useMemo, useState } from 'react';
import { Header } from './components/Header';
import { OptionChainTable } from './components/OptionChainTable';
import { RulesPanel } from './components/RulesPanel';
import { ColumnsPanel } from './components/ColumnsPanel';
import { CommandPalette } from './components/CommandPalette';
import { BottomBar } from './components/BottomBar';
import { useOptionChain } from './hooks/useOptionChain';
import { useComputeEngine } from './hooks/useComputeEngine';
import { useExpiries } from './hooks/useExpiries';
import { useMouseTracking } from './hooks/useMouseTracking';
import { usePaletteController } from './hooks/usePaletteController';
import { useGlobalShortcut } from './hooks/useGlobalShortcut';
import { usePrevSnapshot } from './hooks/usePrevSnapshot';
import { useSessionBaseSpot } from './hooks/useSessionBaseSpot';
import { usePersistedToggle } from './hooks/usePersistedToggle';
import { useIsTablet } from './hooks/useMediaQuery';
import { loadColumns, loadRules, saveColumns, saveRules } from './core/persistence';
import { indexColumnResults, indexRuleResults } from './core/result-index';
import { STORAGE_KEYS } from './core/storage-keys';
import type { CustomColumnDefinition, RuleDefinition } from './core/types';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'] as const;
type SymbolName = typeof SYMBOLS[number];

export function App() {
  const [symbol, setSymbol] = useState<SymbolName>('NIFTY');
  const [expiry, setExpiry] = useState<string>('');

  const [rules, setRules] = useState<RuleDefinition[]>(() => loadRules());
  const [columns, setColumns] = useState<CustomColumnDefinition[]>(() => loadColumns());

  const [rulesOpen, setRulesOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [expanded, setExpanded] = usePersistedToggle(STORAGE_KEYS.expanded);
  const isTablet = useIsTablet();
  const tableExpanded = expanded && !isTablet;

  const palette = usePaletteController();
  const mouse = useMouseTracking();
  useGlobalShortcut({ onSlash: palette.openAtCursor, onCmdK: palette.openCentered });

  useEffect(() => saveRules(rules), [rules]);
  useEffect(() => saveColumns(columns), [columns]);

  const openRules = () => { setRulesOpen((o) => !o); setColumnsOpen(false); };
  const openColumns = () => { setColumnsOpen((o) => !o); setRulesOpen(false); };

  const { data: expiriesData } = useExpiries(symbol);
  const expiries = expiriesData?.expiries ?? [];
  useEffect(() => {
    if (!expiries.length) return;
    if (!expiries.includes(expiry)) setExpiry(expiries[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiries]);

  const data = useOptionChain(symbol);
  const compute = useComputeEngine(data.rows, rules, columns);

  const prevSnapshot = usePrevSnapshot(data.rows);
  const { spotChange, spotPct } = useSessionBaseSpot(data.underlyingValue);

  useEffect(() => {
    if (data.expiryDate && !expiry) setExpiry(data.expiryDate);
  }, [data.expiryDate, expiry]);

  const rulesById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const highlights = useMemo(() => indexRuleResults(compute.ruleResults, rulesById), [compute.ruleResults, rulesById]);
  const columnIndex = useMemo(() => indexColumnResults(compute.columnResults, columns), [compute.columnResults, columns]);

  const ruleCounts: Record<string, number> = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of compute.ruleResults) out[r.ruleId] = r.matches.length;
    return out;
  }, [compute.ruleResults]);

  const totalVolume = useMemo(
    () => data.rows.reduce((s, r) => s + r.call_volume + r.put_volume, 0),
    [data.rows],
  );
  const totalOI = useMemo(
    () => data.rows.reduce((s, r) => s + r.call_oi + r.put_oi, 0),
    [data.rows],
  );

  const enabledRulesCount = rules.filter((r) => r.enabled).length;
  const anyPanelOpen = rulesOpen || columnsOpen;

  return (
    <div className="flex flex-col h-screen relative">
      <Header
        symbol={symbol}
        symbols={SYMBOLS}
        setSymbol={setSymbol}
        expiry={expiry || data.expiryDate || '—'}
        setExpiry={setExpiry}
        expiries={expiries}
        spot={data.underlyingValue}
        spotChange={spotChange}
        spotPct={spotPct}
        rulesOpen={rulesOpen}
        columnsOpen={columnsOpen}
        onToggleRules={openRules}
        onToggleColumns={openColumns}
        ruleCount={enabledRulesCount}
        columnCount={columns.length}
        lastUpdate={data.fetchedAt || Date.now()}
        connected={data.status === 'open'}
        source={data.source}
        totalVolume={totalVolume}
        totalOI={totalOI}
        panelOpen={anyPanelOpen}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
        onAsk={palette.openCentered}
      />

      <main className={`flex-1 overflow-auto bg-bg-0 transition-[padding] duration-300 ${
        anyPanelOpen ? 'sm:pr-[380px]' : ''
      }`}>
        {data.error && (
          <div className="mx-3 mt-3 p-2 rounded border border-pill-neg-border bg-pill-neg text-neg text-sm">
            {data.error}
          </div>
        )}
        <OptionChainTable
          rows={data.rows}
          prevRowsByStrike={prevSnapshot}
          highlights={highlights}
          columnIndex={columnIndex}
          expanded={tableExpanded}
          scrollResetKey={symbol}
          mouse={palette.open ? null : mouse}
        />
      </main>

      <BottomBar
        ruleCount={enabledRulesCount}
        columnCount={columns.length}
        rulesOpen={rulesOpen}
        columnsOpen={columnsOpen}
        onAsk={palette.openCentered}
        onToggleRules={openRules}
        onToggleColumns={openColumns}
      />

      <RulesPanel
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        rules={rules}
        ruleCounts={ruleCounts}
        ruleErrors={compute.configErrors.ruleErrors}
        rows={data.rows}
        columns={columns}
        onChange={setRules}
      />

      <ColumnsPanel
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        columns={columns}
        columnErrors={compute.configErrors.columnErrors}
        cycleErrors={compute.configErrors.cycleErrors}
        rows={data.rows}
        rules={rules}
        onChange={setColumns}
        onRulesChange={setRules}
      />

      <CommandPalette
        open={palette.open}
        onClose={palette.close}
        rules={rules}
        columns={columns}
        rows={data.rows}
        symbol={symbol}
        mouse={mouse}
        anchor={palette.anchor}
        onApplyRule={(rule) => setRules((rs) => [...rs, rule])}
        onApplyColumn={(col) => setColumns((cs) => [...cs, col])}
      />
    </div>
  );
}
