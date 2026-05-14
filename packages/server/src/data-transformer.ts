import type { OptionChainRow, OptionChainSnapshot } from './types.js';
import type { RawNseChain, RawNseLeg, RawNseStrike } from './nse-fetcher.js';

const num = (v: number | undefined | null): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

function legToFields(leg: RawNseLeg | undefined, prefix: 'call' | 'put') {
  return {
    [`${prefix}_oi`]: num(leg?.openInterest),
    [`${prefix}_oiChange`]: num(leg?.changeinOpenInterest),
    [`${prefix}_volume`]: num(leg?.totalTradedVolume),
    [`${prefix}_iv`]: num(leg?.impliedVolatility),
    [`${prefix}_ltp`]: num(leg?.lastPrice),
    [`${prefix}_netChange`]: num(leg?.change),
    [`${prefix}_bidQty`]: num(leg?.bidQty),
    [`${prefix}_bidPrice`]: num(leg?.bidprice),
    [`${prefix}_askQty`]: num(leg?.askQty),
    [`${prefix}_askPrice`]: num(leg?.askPrice),
    // NSE option-chain endpoint doesn't publish greeks. Emit zeros so the
    // row shape matches; consumers that care about greeks should use the
    // TRADL gateway (DATA_SOURCE=tradl-gateway).
    [`${prefix}_delta`]: 0,
    [`${prefix}_gamma`]: 0,
    [`${prefix}_theta`]: 0,
    [`${prefix}_vega`]: 0,
  } as Record<string, number>;
}

function transformStrike(
  strike: RawNseStrike,
  underlyingValue: number,
): OptionChainRow {
  const call = legToFields(strike.CE, 'call');
  const put = legToFields(strike.PE, 'put');
  return {
    strikePrice: strike.strikePrice,
    expiryDate: strike.expiryDate,
    underlyingValue,
    ...(call as Pick<OptionChainRow,
      'call_oi' | 'call_oiChange' | 'call_volume' | 'call_iv' | 'call_ltp'
      | 'call_netChange' | 'call_bidQty' | 'call_bidPrice' | 'call_askQty' | 'call_askPrice'
      | 'call_delta' | 'call_gamma' | 'call_theta' | 'call_vega'>),
    ...(put as Pick<OptionChainRow,
      'put_oi' | 'put_oiChange' | 'put_volume' | 'put_iv' | 'put_ltp'
      | 'put_netChange' | 'put_bidQty' | 'put_bidPrice' | 'put_askQty' | 'put_askPrice'
      | 'put_delta' | 'put_gamma' | 'put_theta' | 'put_vega'>),
  };
}

export function buildSnapshot(
  symbol: string,
  raw: RawNseChain,
  expiryDate?: string,
): OptionChainSnapshot {
  const underlyingValue = num(raw.records.underlyingValue);
  const targetExpiry = expiryDate ?? raw.records.expiryDates?.[0];
  if (!targetExpiry) throw new Error('No expiry available in NSE response');

  const rows = raw.records.data
    .filter((s) => s.expiryDate === targetExpiry)
    .map((s) => transformStrike(s, underlyingValue))
    .sort((a, b) => a.strikePrice - b.strikePrice);

  return {
    symbol,
    expiryDate: targetExpiry,
    underlyingValue,
    fetchedAt: Date.now(),
    rows,
    source: 'nse',
  };
}
