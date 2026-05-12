// Option chain table — clean by default, dense via body.theme-terminal class.
//
// Default columns: Call OI · Call LTP · STRIKE · Put LTP · Put OI (+ custom)
// Expanded adds Call Vol · Call IV on the left, Put IV · Put Vol on the right.
// OI/LTP cells are "stacked": value on top, percent change below.

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnCellResult, CustomColumnDefinition, NumericField, OptionChainRow } from '../core/types';
import {
  type AppliedRule, type CellStyle, type ColumnIndex, type RuleHighlight,
  bgForCell, rulesForCell,
} from '../core/result-index';
import { ruleHsl } from '../core/palette';
import { fmtChange, fmtInt, fmtNum, fmtPct } from '../utils/format';
import { useFlash } from '../hooks/useFlash';
import { CellTooltip, type CellTooltipInfo, type CellTooltipPayload } from './CellTooltip';

interface Props {
  rows: OptionChainRow[];
  prevRowsByStrike: Map<number, OptionChainRow>;
  highlights: RuleHighlight;
  columnIndex: ColumnIndex;
  expanded?: boolean;
  onRowHover?: (row: OptionChainRow | null, matched: AppliedRule[] | null) => void;
  /**
   * When this value changes, the table re-centers on the spot row on the
   * next data render. Pass `symbol` (or anything else that should re-trigger
   * the initial center-scroll behavior).
   */
  scrollResetKey?: string;
}

type ExtraCol = { key: keyof OptionChainRow; label: string; kind: 'int' | 'num'; fields: readonly NumericField[] };

const EXTRA_CALL: ExtraCol[] = [
  { key: 'call_volume', label: 'Call Vol', kind: 'int', fields: ['call_volume'] },
  { key: 'call_iv',     label: 'Call IV',  kind: 'num', fields: ['call_iv'] },
];
const EXTRA_PUT: ExtraCol[] = [
  { key: 'put_iv',      label: 'Put IV',   kind: 'num', fields: ['put_iv'] },
  { key: 'put_volume',  label: 'Put Vol',  kind: 'int', fields: ['put_volume'] },
];

// Each stack-cell shows a primary value + percent-change derived from a
// companion field. Both should count for tinting purposes.
const CALL_OI_FIELDS  = ['call_oi', 'call_oiChange'] as const;
const CALL_LTP_FIELDS = ['call_ltp', 'call_netChange'] as const;
const PUT_OI_FIELDS   = ['put_oi', 'put_oiChange'] as const;
const PUT_LTP_FIELDS  = ['put_ltp', 'put_netChange'] as const;
const STRIKE_FIELDS   = ['strikePrice', 'underlyingValue'] as const;

// ─────────── Cells ───────────

function changeClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return 'text-ink-4';
  if (v > 0) return 'text-pos';
  if (v < 0) return 'text-neg';
  return 'text-ink-4';
}

interface FlashSpanProps {
  value: number | null | undefined;
  prevValue?: number;
  display: string;
  className?: string;
}

// Inline-block span with a brief flash background when value changes.
function FlashSpan({ value, prevValue, display, className }: FlashSpanProps) {
  const flash = useFlash(value, prevValue);
  return (
    <span
      className={`tnum ${flash} ${className ?? ''}`}
      style={{ display: 'inline-block', padding: '0 2px', borderRadius: 3 }}
    >
      {display}
    </span>
  );
}

interface StackCellProps {
  value: number;
  change: number;
  prevValue?: number;
  isPrice: boolean;
}

// Two-line cell: big value above small percent-change.
function StackCell({ value, change, prevValue, isPrice }: StackCellProps) {
  const display = isPrice ? `₹${fmtNum(value, 2)}` : fmtInt(value);
  // Express the absolute change as a percent of the *previous* value when possible
  let pct: number | null = null;
  if (typeof change === 'number' && typeof value === 'number') {
    const base = value - change;
    if (base !== 0) pct = (change / base) * 100;
  }
  const pctStr = pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  return (
    <div className="leading-tight">
      <FlashSpan value={value} prevValue={prevValue} display={display} className="text-ink" />
      <div className={`text-[10px] tnum mt-0.5 ${changeClass(pct)}`}>{pctStr}</div>
    </div>
  );
}

interface PlainCellProps {
  value: number | null | undefined;
  prevValue?: number;
  kind: 'int' | 'num' | 'pct';
  decimals?: number;
}

function PlainCell({ value, prevValue, kind, decimals }: PlainCellProps) {
  if (value == null) return <span className="text-ink-4 italic">—</span>;
  const display =
    kind === 'int' ? fmtInt(value) :
    kind === 'pct' ? fmtPct(value, decimals ?? 2) :
    fmtNum(value, decimals ?? 2);
  return <FlashSpan value={value} prevValue={prevValue} display={display} className="text-[12px]" />;
}

// ─────────── Rule chip strip ───────────
// Tiny per-rule color dots in the strike cell — surfaces collisions that the
// dominant bg color (last-write-wins per scope) would otherwise hide.

function RuleChipStrip({ applied }: { applied: AppliedRule[] | undefined }) {
  if (!applied?.length) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {applied.map((a) => (
        <span
          key={a.rule.id}
          title={a.rule.name}
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: ruleHsl(a.rule.style.hue, 0.95) }}
        />
      ))}
    </span>
  );
}

// ─────────── Strike cell ───────────

function StrikeCell({ row, isATM, applied, style, hover }: {
  row: OptionChainRow;
  isATM: boolean;
  applied: AppliedRule[] | undefined;
  style: CellStyle;
  hover: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
  };
}) {
  const isCallITM = row.strikePrice < row.underlyingValue;
  const isPutITM = row.strikePrice > row.underlyingValue;

  // Moneyness marker bar — green for ITM call, red for ITM put, neutral OTM
  let markerColor = 'bg-ink-4/30';
  let markerWidth = 6;
  if (isCallITM) { markerColor = 'bg-pos/70'; markerWidth = 18; }
  if (isPutITM) { markerColor = 'bg-neg/70'; markerWidth = 18; }

  return (
    <td className="px-1.5 sm:px-3 py-2.5 text-center tnum strike-cell" style={style} {...hover}>
      <div className="leading-tight">
        <div className={isATM
          ? 'text-[13px] sm:text-[14px] font-semibold text-ink'
          : 'text-[12px] sm:text-[13px] text-ink-2'}>
          {fmtInt(row.strikePrice)}
        </div>
        <div className="flex items-center justify-center gap-px mt-1 h-[2px]">
          <span className={`block h-[2px] rounded-sm ${markerColor}`} style={{ width: markerWidth }} />
        </div>
        {applied && applied.length > 0 && (
          <div className="mt-1 flex justify-center">
            <RuleChipStrip applied={applied} />
          </div>
        )}
      </div>
    </td>
  );
}

// ─────────── Strike row ───────────

type CellEnter = (info: CellTooltipInfo, e: React.MouseEvent<HTMLElement>) => void;
type CellLeave = () => void;

interface RowProps {
  row: OptionChainRow;
  prev?: OptionChainRow;
  isATM: boolean;
  expanded: boolean;
  applied: AppliedRule[] | undefined;
  cellMap: Map<NumericField, AppliedRule[]> | undefined;
  cells: { def: CustomColumnDefinition; cell: ColumnCellResult }[];
  customColDefs: CustomColumnDefinition[];
  onHover?: (row: OptionChainRow | null, matched: AppliedRule[] | null) => void;
  onCellEnter: CellEnter;
  onCellLeave: CellLeave;
}

const StrikeRow = memo(function StrikeRow({
  row, prev, isATM, expanded, applied, cellMap, cells, customColDefs,
  onHover, onCellEnter, onCellLeave,
}: RowProps) {
  const isCallITM = row.strikePrice < row.underlyingValue;
  const isPutITM  = row.strikePrice > row.underlyingValue;

  const cellsByCol = new Map(cells.map((c) => [c.def.id, c]));

  const cellBase = 'px-1.5 sm:px-3 py-2.5 text-right tnum whitespace-nowrap relative align-middle';
  const callItm = isCallITM ? ' itm-call' : '';
  const putItm = isPutITM ? ' itm-put' : '';

  const styleFor = (fields: readonly NumericField[]): CellStyle =>
    bgForCell(rulesForCell(cellMap, fields));
  const callOiStyle  = styleFor(CALL_OI_FIELDS);
  const callLtpStyle = styleFor(CALL_LTP_FIELDS);
  const putLtpStyle  = styleFor(PUT_LTP_FIELDS);
  const putOiStyle   = styleFor(PUT_OI_FIELDS);
  const strikeStyle  = styleFor(STRIKE_FIELDS);

  const ruleHover = (fields: readonly NumericField[]) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      const rules = rulesForCell(cellMap, fields);
      if (!rules?.length) return;
      onCellEnter({ kind: 'rule', row, fields, applied: rules }, e);
    },
    onMouseLeave: onCellLeave,
  });
  const customHover = (def: CustomColumnDefinition, cell: ColumnCellResult) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      onCellEnter({ kind: 'custom', row, def, cell }, e);
    },
    onMouseLeave: onCellLeave,
  });

  return (
    <tr
      className={`group transition-colors hover:bg-bg-1/60 ${isATM ? 'r-atm' : ''}`}
      onMouseEnter={() => onHover?.(row, applied ?? [])}
      onMouseLeave={() => onHover?.(null, null)}
    >
      {/* Call extras (Vol, IV) */}
      {expanded && EXTRA_CALL.map((c) => (
        <td
          key={c.key}
          className={`${cellBase} text-ink-3${callItm}`}
          style={styleFor(c.fields)}
          {...ruleHover(c.fields)}
        >
          <PlainCell value={row[c.key] as number} prevValue={prev?.[c.key] as number | undefined} kind={c.kind} />
        </td>
      ))}

      {/* Call OI */}
      <td className={`${cellBase}${callItm}`} style={callOiStyle} {...ruleHover(CALL_OI_FIELDS)}>
        <StackCell value={row.call_oi} change={row.call_oiChange} prevValue={prev?.call_oi} isPrice={false} />
      </td>

      {/* Call LTP */}
      <td className={`${cellBase}${callItm}`} style={callLtpStyle} {...ruleHover(CALL_LTP_FIELDS)}>
        <StackCell value={row.call_ltp} change={row.call_netChange} prevValue={prev?.call_ltp} isPrice={true} />
      </td>

      {/* STRIKE */}
      <StrikeCell
        row={row}
        isATM={isATM}
        applied={applied}
        style={strikeStyle}
        hover={ruleHover(STRIKE_FIELDS)}
      />

      {/* Put LTP */}
      <td className={`${cellBase}${putItm}`} style={putLtpStyle} {...ruleHover(PUT_LTP_FIELDS)}>
        <StackCell value={row.put_ltp} change={row.put_netChange} prevValue={prev?.put_ltp} isPrice={true} />
      </td>

      {/* Put OI */}
      <td className={`${cellBase}${putItm}`} style={putOiStyle} {...ruleHover(PUT_OI_FIELDS)}>
        <StackCell value={row.put_oi} change={row.put_oiChange} prevValue={prev?.put_oi} isPrice={false} />
      </td>

      {/* Put extras (IV, Vol) */}
      {expanded && EXTRA_PUT.map((c) => (
        <td
          key={c.key}
          className={`${cellBase} text-ink-3${putItm}`}
          style={styleFor(c.fields)}
          {...ruleHover(c.fields)}
        >
          <PlainCell value={row[c.key] as number} prevValue={prev?.[c.key] as number | undefined} kind={c.kind} />
        </td>
      ))}

      {/* Custom columns */}
      {customColDefs.map((col) => {
        const entry = cellsByCol.get(col.id);
        const cell = entry?.cell ?? { strikePrice: row.strikePrice, value: null };
        const v = cell.value;
        const err = cell.error;
        return (
          <td
            key={col.id}
            className={`${cellBase} text-ink custom-col`}
            {...customHover(col, cell)}
          >
            {v == null ? (
              <span className="text-ink-4 italic" title={err ?? 'no value'}>—</span>
            ) : (
              <PlainCell value={v} kind={col.format.type === 'percentage' ? 'pct' : 'num'} decimals={col.format.decimals} />
            )}
          </td>
        );
      })}
    </tr>
  );
});

// ─────────── Spot divider row ───────────

function SpotDivider({ spot, baseSpot, totalCols, rowRef }: {
  spot: number;
  baseSpot: number;
  totalCols: number;
  rowRef?: React.Ref<HTMLTableRowElement>;
}) {
  const change = spot - baseSpot;
  const pct = baseSpot ? (change / baseSpot) * 100 : 0;
  const tone =
    change > 0 ? 'text-pos border-pos/50' :
    change < 0 ? 'text-neg border-neg/50' :
    'text-ink border-line-2';
  // Sticky on both edges so the spot pill stays visible regardless of scroll
  // direction: clamps below the column header (top-9) when scrolled down past
  // it, and at the bottom of main (bottom-0) when scrolled up past it. Main
  // sits in a flex column above the BottomBar, so `bottom-0` lands flush
  // above the bar with no gap. Background must be opaque or the rows behind
  // would show through during sticky.
  return (
    <tr
      ref={rowRef}
      className="spot-row sticky top-12 bottom-0 z-[4] bg-bg-0"
    >
      <td colSpan={totalCols} className="relative p-0">
        <div className="relative border-t border-b border-line-2 bg-bg-1/40 h-9 flex items-center">
          {/*
            Horizontal sticky wrapper. The td spans the full table width
            (which can be > viewport when expanded or with custom columns).
            `position: sticky; left: 0; width: 100vw` pins this wrapper to
            the viewport's left edge with viewport width, so the pill inside
            stays centered in the viewport regardless of horizontal scroll.
          */}
          <div
            style={{ position: 'sticky', left: 0, width: '100vw' }}
            className="flex justify-center"
          >
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bg-2 border ${tone}`}>
              <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">spot</span>
              <span className="font-semibold text-[13px] tnum">{fmtNum(spot, 2)}</span>
              <span className={`tnum text-[11px] ${change > 0 ? 'text-pos' : change < 0 ? 'text-neg' : 'text-ink-3'}`}>
                {fmtChange(change)} ({pct > 0 ? '+' : ''}{pct.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─────────── Header cell ───────────

function ColHeader({ children, sub, align = 'right' }: {
  children: React.ReactNode; sub?: React.ReactNode; align?: 'left' | 'right' | 'center';
}) {
  const alignCls = align === 'center' ? 'text-center' : align === 'left' ? 'text-left' : 'text-right';
  return (
    <th className={`px-1.5 sm:px-3 py-2 sm:py-2.5 font-medium text-[10px] sm:text-[11px] text-ink-3 ${alignCls} th-clean whitespace-nowrap`}>
      <div className="leading-tight">
        <div>{children}</div>
        {sub && <div className="text-[9px] sm:text-[9.5px] text-ink-4 mt-0.5 normal-case tracking-normal">{sub}</div>}
      </div>
    </th>
  );
}

// ─────────── Table ───────────

function findAtmStrike(rows: OptionChainRow[], spot: number): number | null {
  if (!rows.length) return null;
  let best = rows[0].strikePrice;
  let bestDist = Math.abs(best - spot);
  for (const r of rows) {
    const d = Math.abs(r.strikePrice - spot);
    if (d < bestDist) { best = r.strikePrice; bestDist = d; }
  }
  return best;
}

export function OptionChainTable({
  rows, prevRowsByStrike, highlights, columnIndex, expanded = false, onRowHover,
  scrollResetKey,
}: Props) {
  const spot = rows[0]?.underlyingValue ?? 0;
  const atm = useMemo(() => findAtmStrike(rows, spot), [rows, spot]);
  const baseSpotRef = useRef<number>(0);
  if (baseSpotRef.current === 0 && spot > 0) baseSpotRef.current = spot;

  const [cellHover, setCellHover] = useState<CellTooltipPayload | null>(null);
  const onCellEnter = useCallback<CellEnter>((info, e) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCellHover({ ...info, anchor: { rect } } as CellTooltipPayload);
  }, []);
  const onCellLeave = useCallback<CellLeave>(() => setCellHover(null), []);

  // The spot divider goes between the last OTM and first ITM strike — i.e.
  // before the first row whose strike >= spot.
  const spotIdx = useMemo(() => rows.findIndex((r) => r.strikePrice >= spot), [rows, spot]);

  // Scroll-to-center on first paint after data populates. Re-runs when
  // `scrollResetKey` changes (symbol switch) so users land on the spot row
  // without manual scrolling. Subsequent ticks don't re-scroll — `centeredRef`
  // gates further calls.
  const spotRowRef = useRef<HTMLTableRowElement | null>(null);
  const centeredRef = useRef(false);
  useEffect(() => { centeredRef.current = false; }, [scrollResetKey]);
  useEffect(() => {
    if (centeredRef.current || !rows.length || !spotRowRef.current) return;
    spotRowRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
    centeredRef.current = true;
  }, [rows.length]);

  if (!rows.length) {
    return <div className="px-5 py-10 text-ink-3 text-sm">Waiting for first snapshot…</div>;
  }

  const customCols = columnIndex.defs;
  const totalCols =
    (expanded ? EXTRA_CALL.length : 0)
    + 2  // call OI + LTP
    + 1  // strike
    + 2  // put LTP + OI
    + (expanded ? EXTRA_PUT.length : 0)
    + customCols.length;

  return (
    <div className="w-full">
      <table className="w-full border-separate border-spacing-0 text-[11px] sm:text-[12.5px] leading-none chain-table">
        <thead>
          {/* h-9 matches the spot row's `top-9` sticky offset so the spot
              clamps right below the column header without overlap. */}
          <tr className="sticky top-0 z-[5] bg-bg-0 h-9">
            {expanded && EXTRA_CALL.map((c) => <ColHeader key={c.key}>{c.label}</ColHeader>)}
            <ColHeader sub="Δ %">Call OI</ColHeader>
            <ColHeader sub="Δ %">Call LTP</ColHeader>
            <ColHeader align="center">Strike</ColHeader>
            <ColHeader sub="Δ %">Put LTP</ColHeader>
            <ColHeader sub="Δ %">Put OI</ColHeader>
            {expanded && EXTRA_PUT.map((c) => <ColHeader key={c.key}>{c.label}</ColHeader>)}
            {customCols.map((c) => (
              <ColHeader key={c.id}>
                <span title={c.expression}>{c.name} <span className="text-ink-4 italic">ƒ</span></span>
              </ColHeader>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <Fragment key={row.strikePrice}>
              {i === spotIdx && spotIdx > 0 && (
                <SpotDivider
                  spot={spot}
                  baseSpot={baseSpotRef.current || spot}
                  totalCols={totalCols}
                  rowRef={spotRowRef}
                />
              )}
              <StrikeRow
                row={row}
                prev={prevRowsByStrike.get(row.strikePrice)}
                isATM={row.strikePrice === atm}
                expanded={expanded}
                applied={highlights.byStrike.get(row.strikePrice)}
                cellMap={highlights.byCell.get(row.strikePrice)}
                cells={columnIndex.byStrike.get(row.strikePrice) ?? []}
                customColDefs={customCols}
                onHover={onRowHover}
                onCellEnter={onCellEnter}
                onCellLeave={onCellLeave}
              />
            </Fragment>
          ))}
        </tbody>
      </table>
      <CellTooltip payload={cellHover} />
    </div>
  );
}
