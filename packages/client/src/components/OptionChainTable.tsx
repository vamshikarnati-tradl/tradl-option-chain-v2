import { memo, useEffect, useMemo, useState } from 'react';
import type { CustomColumnDefinition, OptionChainRow } from '../core/types';
import { type AppliedRule, type ColumnIndex, type RuleHighlight, bgForScope } from '../core/result-index';
import { fmtChange, fmtInt, fmtNum, fmtPct } from '../utils/format';

interface Props {
  rows: OptionChainRow[];
  prevRowsByStrike: Map<number, OptionChainRow>;
  highlights: RuleHighlight;
  columnIndex: ColumnIndex;
  onRowHover?: (row: OptionChainRow | null, matched: AppliedRule[] | null) => void;
}

type CellKind = 'int' | 'change-int' | 'num' | 'change' | 'pct';

interface ColDef {
  key: keyof OptionChainRow;
  label: string;
  kind: CellKind;
}

const STATIC_CALL: ColDef[] = [
  { key: 'call_oi',        label: 'OI',    kind: 'int' },
  { key: 'call_oiChange',  label: 'Δ OI',  kind: 'change-int' },
  { key: 'call_volume',    label: 'Vol',   kind: 'int' },
  { key: 'call_iv',        label: 'IV',    kind: 'num' },
  { key: 'call_ltp',       label: 'LTP',   kind: 'num' },
  { key: 'call_netChange', label: 'Chg',   kind: 'change' },
];
const STATIC_PUT: ColDef[] = [
  { key: 'put_netChange',  label: 'Chg',   kind: 'change' },
  { key: 'put_ltp',        label: 'LTP',   kind: 'num' },
  { key: 'put_iv',         label: 'IV',    kind: 'num' },
  { key: 'put_volume',     label: 'Vol',   kind: 'int' },
  { key: 'put_oiChange',   label: 'Δ OI',  kind: 'change-int' },
  { key: 'put_oi',         label: 'OI',    kind: 'int' },
];

function fmtCell(value: number | null | undefined, kind: CellKind): string {
  if (value == null) return '—';
  switch (kind) {
    case 'int':
    case 'change-int': return fmtInt(value);
    case 'change':     return fmtChange(value);
    case 'pct':        return fmtPct(value);
    case 'num':        return fmtNum(value);
  }
}

function changeClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '';
  if (v > 0) return 'text-pos';
  if (v < 0) return 'text-neg';
  return '';
}

interface FlashCellProps {
  value: number | null | undefined;
  kind: CellKind;
  prevValue?: number;
  customColor?: string;
}

function FlashCell({ value, kind, prevValue, customColor }: FlashCellProps) {
  const [flash, setFlash] = useState<'flash-up' | 'flash-dn' | ''>('');
  useEffect(() => {
    if (
      prevValue !== undefined &&
      typeof value === 'number' &&
      typeof prevValue === 'number' &&
      value !== prevValue
    ) {
      const dir = value > prevValue ? 'flash-up' : 'flash-dn';
      setFlash(dir);
      const t = setTimeout(() => setFlash(''), 700);
      return () => clearTimeout(t);
    }
  }, [value, prevValue]);
  const isChange = kind === 'change' || kind === 'change-int';
  const cls = [flash, isChange ? changeClass(value) : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} style={customColor ? { color: customColor } : undefined}>
      {fmtCell(value, kind)}
    </span>
  );
}

function customCellColor(value: number | null, def: CustomColumnDefinition): string | undefined {
  if (value == null) return undefined;
  const cs = def.format.colorScale;
  if (!cs) return undefined;
  if (value > 0) return cs.positive;
  if (value < 0) return cs.negative;
  return undefined;
}

interface RowProps {
  row: OptionChainRow;
  prev?: OptionChainRow;
  isATM: boolean;
  applied: AppliedRule[] | undefined;
  cells: { def: CustomColumnDefinition; cell: { value: number | null; error?: string } }[];
  customColDefs: CustomColumnDefinition[];
  onHover?: (row: OptionChainRow | null, matched: AppliedRule[] | null) => void;
}

const cellBase =
  'h-8 px-2.5 text-right border-b border-line tnum whitespace-nowrap relative align-middle';

const StrikeRow = memo(function StrikeRow({
  row, prev, isATM, applied, cells, customColDefs, onHover,
}: RowProps) {
  const callBg = bgForScope(applied, 'call');
  const putBg  = bgForScope(applied, 'put');
  const rowBg  = bgForScope(applied, 'row');

  const isCallITM = row.strikePrice < row.underlyingValue;
  const isPutITM  = row.strikePrice > row.underlyingValue;

  const cellsByCol = new Map(cells.map((c) => [c.def.id, c]));

  return (
    <tr
      className={`transition-colors hover:bg-bg-1 ${isATM ? 'r-atm' : ''}`}
      onMouseEnter={() => onHover?.(row, applied ?? [])}
      onMouseLeave={() => onHover?.(null, null)}
      style={rowBg ? { background: rowBg } : undefined}
    >
      {STATIC_CALL.map((col) => (
        <td
          key={col.key}
          className={`${cellBase} ${isCallITM && !callBg ? 'itm-call' : ''}`}
          style={callBg ? { background: callBg } : undefined}
        >
          <FlashCell
            value={row[col.key] as number}
            kind={col.kind}
            prevValue={prev ? (prev[col.key] as number) : undefined}
          />
        </td>
      ))}

      <td className={`h-8 px-2.5 text-center font-semibold bg-bg-2 border-l border-r border-b border-line tnum relative ${isATM ? 'text-[hsl(45,90%,70%)]' : 'text-ink'}`}>
        <span className="tnum">{fmtInt(row.strikePrice)}</span>
        {isATM && (
          <span className="absolute top-0.5 right-1 text-[8px] font-semibold text-[hsl(45,90%,70%)] tracking-[0.08em]">
            ATM
          </span>
        )}
      </td>

      {STATIC_PUT.map((col) => (
        <td
          key={col.key}
          className={`${cellBase} ${isPutITM && !putBg ? 'itm-put' : ''}`}
          style={putBg ? { background: putBg } : undefined}
        >
          <FlashCell
            value={row[col.key] as number}
            kind={col.kind}
            prevValue={prev ? (prev[col.key] as number) : undefined}
          />
        </td>
      ))}

      {customColDefs.map((col) => {
        const entry = cellsByCol.get(col.id);
        const v = entry?.cell.value ?? null;
        const err = entry?.cell.error;
        return (
          <td
            key={col.id}
            className="h-8 px-2.5 text-right tnum whitespace-nowrap text-[hsl(220,30%,80%)] bg-bg-1 border-l border-dashed border-line-2 border-b border-line"
          >
            {v == null ? (
              <span className="text-ink-4 italic" title={err ?? 'no value'}>—</span>
            ) : (
              <FlashCell
                value={v}
                kind={col.format.type === 'percentage' ? 'pct' : 'num'}
                customColor={customCellColor(v, col)}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
});

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

const headerBase =
  'px-2.5 py-2 text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3 border-b border-line bg-bg-1 whitespace-nowrap';

export function OptionChainTable({
  rows, prevRowsByStrike, highlights, columnIndex, onRowHover,
}: Props) {
  const spot = rows[0]?.underlyingValue ?? 0;
  const atm = useMemo(() => findAtmStrike(rows, spot), [rows, spot]);

  if (!rows.length) {
    return <div className="px-5 py-10 text-ink-3 text-sm">Waiting for first snapshot…</div>;
  }

  const customCols = columnIndex.defs;

  return (
    <div className="w-full">
      <table className="w-full border-separate border-spacing-0 font-mono tnum text-xs leading-none">
        <thead>
          <tr className="sticky top-0 z-[5] bg-bg-1">
            <th colSpan={STATIC_CALL.length} className="px-2.5 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[hsl(150,40%,70%)] border-b border-line">CALLS</th>
            <th className="px-2.5 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-2 bg-bg-2 border-b border-l border-r border-line">STRIKE</th>
            <th colSpan={STATIC_PUT.length} className="px-2.5 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[hsl(0,40%,75%)] border-b border-line">PUTS</th>
            {customCols.length > 0 && (
              <th colSpan={customCols.length} className="px-2.5 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[hsl(220,40%,75%)] border-b border-line">CUSTOM</th>
            )}
          </tr>
          <tr className="sticky top-[30px] z-[5] bg-bg-1">
            {STATIC_CALL.map((c) => <th key={c.key} className={headerBase}>{c.label}</th>)}
            <th className={`${headerBase} bg-bg-2 text-center text-ink-2 border-l border-r border-line`}>Strike</th>
            {STATIC_PUT.map((c) => <th key={c.key} className={headerBase}>{c.label}</th>)}
            {customCols.map((c) => (
              <th key={c.id} className={`${headerBase} text-[hsl(220,30%,70%)]`} title={c.expression}>
                {c.name} <span className="text-ink-4 ml-0.5 italic">ƒ</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <StrikeRow
              key={row.strikePrice}
              row={row}
              prev={prevRowsByStrike.get(row.strikePrice)}
              isATM={row.strikePrice === atm}
              applied={highlights.byStrike.get(row.strikePrice)}
              cells={columnIndex.byStrike.get(row.strikePrice) ?? []}
              customColDefs={customCols}
              onHover={onRowHover}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
