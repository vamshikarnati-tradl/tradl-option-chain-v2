// TRADL gateway HTTP helpers. Pure fetch wrappers — no state, no reconnect
// logic (that lives in `tradl-source.ts`). All three helpers take a long-lived
// API bearer (`ak_…`) and either mint a ws_token, cold-load a chain snapshot,
// or list available expiries for a symbol.
//
// Field normalization here matches the schema described in
// FRONTEND_INTEGRATION.md: the gateway emits nested `ce`/`pe` legs with IV
// as a percent number and greeks inline. We flatten to the app's existing
// flat `call_*` / `put_*` shape so the client compute engine + rule engine
// don't need to know the wire format changed.

import type { OptionChainRow, OptionChainSnapshot } from './types.js';

// ─── Upstream wire types (nested, gateway shape) ─────────────────────────

interface TradlLeg {
  symbol?: string;
  exchange?: string;
  ltp: number | null;
  volume: number | null;
  oi: number | null;
  oi_change: number | null;
  net_change: number | null;
  bid_qty: number | null;
  bid_price: number | null;
  ask_qty: number | null;
  ask_price: number | null;
  iv: number | null;        // already a percent number (19.78 = 19.78%)
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface TradlStrike {
  strike: number;
  ce: TradlLeg | null;
  pe: TradlLeg | null;
}

export interface TradlChainEnvelope {
  underlying: string;
  expiry: string;
  underlying_ltp: number | null;
  asof: number | null;
  strikes: TradlStrike[];
}

interface ExpiriesResponse {
  underlying: string;
  expiries: string[];
  asof?: string;
}

interface WsTokenResponse {
  token: string;
  expires_at?: number;
}

// ─── Normalization ───────────────────────────────────────────────────────

const n = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export function flattenStrike(
  s: TradlStrike,
  underlyingValue: number,
  expiry: string,
): OptionChainRow {
  const ce = s.ce ?? null;
  const pe = s.pe ?? null;
  return {
    strikePrice: s.strike,
    expiryDate: expiry,
    underlyingValue,

    call_oi:        n(ce?.oi),
    call_oiChange:  n(ce?.oi_change),
    call_volume:    n(ce?.volume),
    call_iv:        n(ce?.iv),
    call_ltp:       n(ce?.ltp),
    call_netChange: n(ce?.net_change),
    call_bidQty:    n(ce?.bid_qty),
    call_bidPrice:  n(ce?.bid_price),
    call_askQty:    n(ce?.ask_qty),
    call_askPrice:  n(ce?.ask_price),
    call_delta:     n(ce?.delta),
    call_gamma:     n(ce?.gamma),
    call_theta:     n(ce?.theta),
    call_vega:      n(ce?.vega),

    put_oi:        n(pe?.oi),
    put_oiChange:  n(pe?.oi_change),
    put_volume:    n(pe?.volume),
    put_iv:        n(pe?.iv),
    put_ltp:       n(pe?.ltp),
    put_netChange: n(pe?.net_change),
    put_bidQty:    n(pe?.bid_qty),
    put_bidPrice:  n(pe?.bid_price),
    put_askQty:    n(pe?.ask_qty),
    put_askPrice:  n(pe?.ask_price),
    put_delta:     n(pe?.delta),
    put_gamma:     n(pe?.gamma),
    put_theta:     n(pe?.theta),
    put_vega:      n(pe?.vega),
  };
}

export function envelopeToSnapshot(env: TradlChainEnvelope): OptionChainSnapshot {
  const underlying = env.underlying;
  const expiry = env.expiry;
  const underlyingValue = n(env.underlying_ltp);
  const rows = env.strikes
    .map((s) => flattenStrike(s, underlyingValue, expiry))
    .sort((a, b) => a.strikePrice - b.strikePrice);
  return {
    symbol: underlying,
    expiryDate: expiry,
    underlyingValue,
    fetchedAt: env.asof ?? Date.now(),
    rows,
    source: 'tradl-gateway',
  };
}

// ─── HTTP helpers ────────────────────────────────────────────────────────

const REST_BASE = process.env.TRADL_GATEWAY_REST ?? 'http://13.203.178.90:9096';

async function tradlFetch(path: string, bearer: string): Promise<unknown> {
  const res = await fetch(`${REST_BASE}${path}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TRADL ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Mint a short-lived ws_token. Cached briefly (TTL ~4 min — well below the
// 5 min token lifetime mentioned in the gateway docs).
const TOKEN_TTL_MS = 4 * 60 * 1000;
let cachedToken: { value: string; fetchedAt: number } | null = null;

export async function mintWsToken(bearer: string): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) {
    return cachedToken.value;
  }
  const res = await fetch(`${REST_BASE}/v1/auth/ws-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TRADL ws-token ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as WsTokenResponse;
  if (!json.token) throw new Error('TRADL ws-token: empty token in response');
  cachedToken = { value: json.token, fetchedAt: Date.now() };
  return json.token;
}

// Force the next mint to re-call the server. Used on close code 4401.
export function invalidateWsToken(): void {
  cachedToken = null;
}

export async function coldLoadChain(
  symbol: string,
  expiry: string,
  bearer: string,
): Promise<OptionChainSnapshot> {
  const env = (await tradlFetch(`/v1/option-chain/${symbol}/${expiry}`, bearer)) as TradlChainEnvelope;
  return envelopeToSnapshot(env);
}

export async function listExpiries(symbol: string, bearer: string): Promise<string[]> {
  const res = (await tradlFetch(`/v1/option-chain/${symbol}/expiries`, bearer)) as ExpiriesResponse;
  return Array.isArray(res.expiries) ? res.expiries : [];
}
