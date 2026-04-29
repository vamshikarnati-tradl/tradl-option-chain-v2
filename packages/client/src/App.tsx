import { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { OptionChainTable } from './components/OptionChainTable';
import { RulesPanel } from './components/RulesPanel';
import { ColumnsPanel } from './components/ColumnsPanel';
import { HoverTooltip } from './components/HoverTooltip';
import { useOptionChain } from './hooks/useOptionChain';
import { useComputeEngine } from './hooks/useComputeEngine';
import { loadColumns, loadRules, saveColumns, saveRules } from './core/persistence';
import { indexColumnResults, indexRuleResults, type AppliedRule } from './core/result-index';
import type { CustomColumnDefinition, OptionChainRow, RuleDefinition } from './core/types';

type Symbol = 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'MIDCPNIFTY';

interface ExpiryResp { symbol: string; expiries: string[] }

export function App() {
  const [symbol, setSymbol] = useState<Symbol>('NIFTY');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string>('');

  const [rules, setRules] = useState<RuleDefinition[]>(() => loadRules());
  const [columns, setColumns] = useState<CustomColumnDefinition[]>(() => loadColumns());

  const [rulesOpen, setRulesOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const [hoverRow, setHoverRow] = useState<OptionChainRow | null>(null);
  const [hoverMatched, setHoverMatched] = useState<AppliedRule[] | null>(null);
  const [hoverMouse, setHoverMouse] = useState<{ x: number; y: number } | null>(null);

  // Persist user changes
  useEffect(() => saveRules(rules), [rules]);
  useEffect(() => saveColumns(columns), [columns]);

  // Mouse tracking for the hover tooltip
  useEffect(() => {
    const onMove = (e: MouseEvent) => setHoverMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Fetch expiries when symbol changes
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/expiries/${symbol}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((j: ExpiryResp) => {
        if (cancelled) return;
        setExpiries(j.expiries);
        if (!j.expiries.includes(expiry)) setExpiry(j.expiries[0] ?? '');
      })
      .catch(() => { /* silent — header just shows current expiry */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const data = useOptionChain(symbol);
  const compute = useComputeEngine(data.rows, rules, columns);

  // Track previous-snapshot rows by strike so FlashCell can compare values.
  const prevRowsByStrikeRef = useRef<Map<number, OptionChainRow>>(new Map());
  const lastSnapshotIdRef = useRef<number>(-1);
  if (data.snapshotCount !== lastSnapshotIdRef.current) {
    lastSnapshotIdRef.current = data.snapshotCount;
    // Capture pre-update state on every new snapshot (rolled forward from prev render).
  }

  // Roll prevRowsByStrikeRef forward each render: capture *current* rows so the
  // next snapshot's render can compare against this one.
  const prevSnapshot = prevRowsByStrikeRef.current;
  const nextSnapshot = useMemo(() => {
    const m = new Map<number, OptionChainRow>();
    for (const r of data.rows) m.set(r.strikePrice, r);
    return m;
  }, [data.rows]);

  useEffect(() => {
    prevRowsByStrikeRef.current = nextSnapshot;
  }, [nextSnapshot]);

  // Sync expiry in header to whatever the data store knows (it follows the most recent snapshot)
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

  // Spot change vs the first snapshot we saw — gives a session-relative delta.
  const sessionBaseSpotRef = useRef<number | null>(null);
  if (sessionBaseSpotRef.current == null && data.underlyingValue > 0) {
    sessionBaseSpotRef.current = data.underlyingValue;
  }
  const baseSpot = sessionBaseSpotRef.current ?? data.underlyingValue ?? 1;
  const spotChange = data.underlyingValue - baseSpot;
  const spotPct = baseSpot ? (spotChange / baseSpot) * 100 : 0;

  const sampleRow = data.rows.length ? data.rows[Math.floor(data.rows.length / 2)] : undefined;
  const enabledRulesCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="flex flex-col h-screen relative">
      <Header
        symbol={symbol}
        setSymbol={(s) => setSymbol(s as Symbol)}
        expiry={expiry || data.expiryDate || '—'}
        setExpiry={setExpiry}
        expiries={expiries}
        spot={data.underlyingValue}
        spotChange={spotChange}
        spotPct={spotPct}
        rulesOpen={rulesOpen}
        columnsOpen={columnsOpen}
        onToggleRules={() => { setRulesOpen((o) => !o); setColumnsOpen(false); }}
        onToggleColumns={() => { setColumnsOpen((o) => !o); setRulesOpen(false); }}
        ruleCount={enabledRulesCount}
        columnCount={columns.length}
        lastUpdate={data.fetchedAt || Date.now()}
        connected={data.status === 'open'}
        totalVolume={totalVolume}
        totalOI={totalOI}
        panelOpen={rulesOpen || columnsOpen}
      />

      <main className={`flex-1 overflow-auto bg-bg-0 transition-[padding] duration-300 ${
        rulesOpen || columnsOpen ? 'pr-[380px]' : ''
      }`}>
        {data.error && (
          <div className="mx-3 mt-3 p-2 rounded border border-[hsla(0,60%,30%,0.6)] bg-[hsla(0,60%,30%,0.2)] text-neg text-sm">
            {data.error}
          </div>
        )}
        <OptionChainTable
          rows={data.rows}
          prevRowsByStrike={prevSnapshot}
          highlights={highlights}
          columnIndex={columnIndex}
          onRowHover={(row, matched) => {
            setHoverRow(row);
            setHoverMatched(matched);
          }}
        />
      </main>

      <RulesPanel
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        rules={rules}
        ruleCounts={ruleCounts}
        ruleErrors={compute.configErrors.ruleErrors}
        onChange={setRules}
      />

      <ColumnsPanel
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        columns={columns}
        columnErrors={compute.configErrors.columnErrors}
        sampleRow={sampleRow}
        onChange={setColumns}
      />

      {hoverRow && <HoverTooltip row={hoverRow} matched={hoverMatched} mouse={hoverMouse} />}
    </div>
  );
}
