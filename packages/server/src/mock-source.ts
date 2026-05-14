import type { OptionChainRow, OptionChainSnapshot } from './types.js';

// Simulates a Nifty-like option chain with realistic OI / IV / LTP shapes
// and tick-to-tick movement. Used when NSE is unreachable or blocked.

interface MockState {
  symbol: string;
  spot: number;
  baseSpot: number;
  expiryDate: string;
  expiries: string[];
  strikes: number[];
  prev: Map<number, OptionChainRow>;
  tick: number;
}

const symbolDefaults: Record<string, { baseSpot: number; strikeStep: number; strikeCount: number }> = {
  NIFTY: { baseSpot: 24_200, strikeStep: 50, strikeCount: 41 },
  BANKNIFTY: { baseSpot: 52_000, strikeStep: 100, strikeCount: 41 },
  FINNIFTY: { baseSpot: 23_400, strikeStep: 50, strikeCount: 41 },
  MIDCPNIFTY: { baseSpot: 12_450, strikeStep: 25, strikeCount: 41 },
};

function nextThursday(from: Date): Date {
  const d = new Date(from);
  const day = d.getUTCDay();
  const add = (4 - day + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

function fmtExpiry(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function buildExpiries(): string[] {
  const now = new Date();
  const out: string[] = [];
  let d = nextThursday(now);
  for (let i = 0; i < 6; i++) {
    out.push(fmtExpiry(d));
    d = new Date(d);
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

function buildStrikes(spot: number, step: number, count: number): number[] {
  const atm = Math.round(spot / step) * step;
  const half = Math.floor(count / 2);
  const out: number[] = [];
  for (let i = -half; i <= half; i++) out.push(atm + i * step);
  return out;
}

function gauss(mean = 0, std = 1): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function intrinsic(spot: number, strike: number, side: 'C' | 'P'): number {
  return side === 'C' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

function timeValue(spot: number, strike: number, daysToExpiry: number, iv: number): number {
  const moneyness = Math.abs(spot - strike) / spot;
  const decay = Math.exp(-moneyness * moneyness * 30);
  return spot * iv * 0.01 * Math.sqrt(daysToExpiry / 365) * decay;
}

function generateRow(
  state: MockState,
  strike: number,
  prev: OptionChainRow | undefined,
): OptionChainRow {
  const spot = state.spot;
  const distance = Math.abs(strike - spot) / spot;

  const callBaseIV = 14 + distance * 80 + gauss(0, 0.3);
  const putBaseIV = 14 + distance * 85 + gauss(0, 0.3);
  const call_iv = clamp(prev?.call_iv ? prev.call_iv * 0.92 + callBaseIV * 0.08 : callBaseIV, 8, 60);
  const put_iv = clamp(prev?.put_iv ? prev.put_iv * 0.92 + putBaseIV * 0.08 : putBaseIV, 8, 60);

  const days = 7;
  const callTV = timeValue(spot, strike, days, call_iv);
  const putTV = timeValue(spot, strike, days, put_iv);

  const call_ltp = Math.max(0.05, intrinsic(spot, strike, 'C') + callTV + gauss(0, 0.5));
  const put_ltp = Math.max(0.05, intrinsic(spot, strike, 'P') + putTV + gauss(0, 0.5));

  const prevCallLtp = prev?.call_ltp ?? call_ltp;
  const prevPutLtp = prev?.put_ltp ?? put_ltp;

  // OI heaviest near round numbers and ATM
  const roundFactor = strike % 100 === 0 ? 1.6 : strike % 50 === 0 ? 1.0 : 0.7;
  const atmDistance = Math.abs(strike - spot) / 100;
  const callOiBase = Math.max(
    1000,
    300_000 * Math.exp(-Math.pow(atmDistance + 0.8, 2) / 6) * roundFactor,
  );
  const putOiBase = Math.max(
    1000,
    300_000 * Math.exp(-Math.pow(atmDistance - 0.8, 2) / 6) * roundFactor,
  );

  const call_oi = Math.round(prev?.call_oi ? prev.call_oi + gauss(0, prev.call_oi * 0.02) : callOiBase);
  const put_oi = Math.round(prev?.put_oi ? prev.put_oi + gauss(0, prev.put_oi * 0.02) : putOiBase);
  const call_oiChange = prev ? call_oi - prev.call_oi : Math.round(gauss(0, callOiBase * 0.05));
  const put_oiChange = prev ? put_oi - prev.put_oi : Math.round(gauss(0, putOiBase * 0.05));

  const call_volume = Math.max(0, Math.round((prev?.call_volume ?? 0) + Math.abs(gauss(0, callOiBase * 0.1))));
  const put_volume = Math.max(0, Math.round((prev?.put_volume ?? 0) + Math.abs(gauss(0, putOiBase * 0.1))));

  const callSpread = Math.max(0.05, call_ltp * 0.005);
  const putSpread = Math.max(0.05, put_ltp * 0.005);

  // Cheap analytical greeks. Not Black-Scholes precise — enough to exercise
  // the rule engine and table display during dev. ITM call delta saturates
  // toward 1, OTM toward 0; gamma peaks at ATM; theta scales with time value;
  // vega scales with strike-to-spot proximity.
  const moneynessCall = (spot - strike) / spot;       // +ve when ITM call
  const moneynessPut  = (strike - spot) / spot;       // +ve when ITM put
  const call_delta = clamp(0.5 + moneynessCall * 4, 0, 1);
  const put_delta  = clamp(-(0.5 + moneynessPut * 4), -1, 0);
  const gammaPeak  = Math.exp(-Math.pow((strike - spot) / spot, 2) * 80);
  const call_gamma = Number((gammaPeak * 0.002).toFixed(6));
  const put_gamma  = Number((gammaPeak * 0.002).toFixed(6));
  const call_theta = Number((-callTV / Math.max(days, 1) * 1.1).toFixed(2));
  const put_theta  = Number((-putTV  / Math.max(days, 1) * 1.1).toFixed(2));
  const call_vega  = Number((spot * 0.01 * gammaPeak * 10).toFixed(2));
  const put_vega   = Number((spot * 0.01 * gammaPeak * 10).toFixed(2));

  return {
    strikePrice: strike,
    expiryDate: state.expiryDate,
    underlyingValue: Number(spot.toFixed(2)),

    call_oi,
    call_oiChange,
    call_volume,
    call_iv: Number(call_iv.toFixed(2)),
    call_ltp: Number(call_ltp.toFixed(2)),
    call_netChange: Number((call_ltp - prevCallLtp).toFixed(2)),
    call_bidQty: Math.round(50 + Math.abs(gauss(0, 200))),
    call_bidPrice: Number(Math.max(0.05, call_ltp - callSpread).toFixed(2)),
    call_askQty: Math.round(50 + Math.abs(gauss(0, 200))),
    call_askPrice: Number((call_ltp + callSpread).toFixed(2)),
    call_delta: Number(call_delta.toFixed(3)),
    call_gamma,
    call_theta,
    call_vega,

    put_oi,
    put_oiChange,
    put_volume,
    put_iv: Number(put_iv.toFixed(2)),
    put_ltp: Number(put_ltp.toFixed(2)),
    put_netChange: Number((put_ltp - prevPutLtp).toFixed(2)),
    put_bidQty: Math.round(50 + Math.abs(gauss(0, 200))),
    put_bidPrice: Number(Math.max(0.05, put_ltp - putSpread).toFixed(2)),
    put_askQty: Math.round(50 + Math.abs(gauss(0, 200))),
    put_askPrice: Number((put_ltp + putSpread).toFixed(2)),
    put_delta: Number(put_delta.toFixed(3)),
    put_gamma,
    put_theta,
    put_vega,
  };
}

const stateBySymbol = new Map<string, MockState>();

function ensureState(symbol: string): MockState {
  let s = stateBySymbol.get(symbol);
  if (s) return s;
  const cfg = symbolDefaults[symbol] ?? symbolDefaults.NIFTY;
  const expiries = buildExpiries();
  s = {
    symbol,
    spot: cfg.baseSpot,
    baseSpot: cfg.baseSpot,
    expiryDate: expiries[0],
    expiries,
    strikes: buildStrikes(cfg.baseSpot, cfg.strikeStep, cfg.strikeCount),
    prev: new Map(),
    tick: 0,
  };
  stateBySymbol.set(symbol, s);
  return s;
}

export function getMockExpiries(symbol: string): string[] {
  return ensureState(symbol).expiries;
}

export function buildMockSnapshot(symbol: string, expiryDate?: string): OptionChainSnapshot {
  const s = ensureState(symbol);
  s.tick++;

  // Mean-reverting random walk on spot
  const drift = (s.baseSpot - s.spot) * 0.05;
  s.spot = clamp(s.spot + drift + gauss(0, s.baseSpot * 0.0008), s.baseSpot * 0.97, s.baseSpot * 1.03);

  if (expiryDate && s.expiries.includes(expiryDate)) s.expiryDate = expiryDate;

  const rows = s.strikes.map((strike) => {
    const row = generateRow(s, strike, s.prev.get(strike));
    s.prev.set(strike, row);
    return row;
  });

  return {
    symbol,
    expiryDate: s.expiryDate,
    underlyingValue: Number(s.spot.toFixed(2)),
    fetchedAt: Date.now(),
    rows,
    source: 'mock',
  };
}
