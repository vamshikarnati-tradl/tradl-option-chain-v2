// Upstream TRADL gateway WS manager.
//
// Responsibilities:
//   - Maintain one WS connection per (symbol, expiry) regardless of how many
//     downstream consumers want it. Refcounted; closes when last consumer leaves.
//   - REST cold-load + WS delta merge into a single OptionChainSnapshot view.
//     Race protection: subscribe FIRST, then cold-load; drop WS frames whose
//     `asof` precedes the cold-load snapshot (per gateway docs §1).
//   - Reconnect with exponential backoff (1, 2, 4, 8, 16, cap 30 s). On close
//     code 4401 (auth expired), re-mint the ws_token and try again.
//   - Emit a full normalized OptionChainSnapshot to every subscribed consumer
//     on every upstream frame (consumer doesn't need to know about deltas).

import { WebSocket } from 'ws';
import type { OptionChainRow, OptionChainSnapshot } from './types.js';
import {
  coldLoadChain, flattenStrike, invalidateWsToken, listExpiries, mintWsToken,
  type TradlChainEnvelope, type TradlStrike,
} from './tradl-fetcher.js';

const WS_BASE = process.env.TRADL_GATEWAY_WS ?? 'ws://13.203.178.90:9097/v1/stream';

// Frame logger — gated by TRADL_DEBUG=1. Auth (ak_* bearer, ws_token) lives
// in REST headers + WS subprotocol, NEVER in any frame payload. So logging
// raw frames is safe — no secrets leak.
//
// First N frames per (direction, subscription) get pretty-printed in full so
// you can verify shapes; beyond that we summarize to keep stdout legible at
// ~250 ms cadence. Override the threshold with TRADL_DEBUG_VERBOSE_COUNT.
const DEBUG = process.env.TRADL_DEBUG === '1';
const VERBOSE_COUNT = Number(process.env.TRADL_DEBUG_VERBOSE_COUNT ?? 10);
const frameCounts = new Map<string, number>();

function logFrame(direction: '→ SEND' | '← RECV', subKey: string, payload: unknown): void {
  if (!DEBUG) return;
  const countKey = `${direction}.${subKey}`;
  const n = (frameCounts.get(countKey) ?? 0) + 1;
  frameCounts.set(countKey, n);
  if (n <= VERBOSE_COUNT) {
    console.log(`[tradl ${subKey}] ${direction} frame #${n}:\n${JSON.stringify(payload, null, 2)}`);
  } else {
    const s = JSON.stringify(payload);
    const summary = s.length > 240 ? s.slice(0, 240) + '…' : s;
    console.log(`[tradl ${subKey}] ${direction} frame #${n}: ${summary}`);
  }
}

type SnapshotListener = (snap: OptionChainSnapshot) => void;
type ErrorListener = (err: Error) => void;

interface Subscription {
  symbol: string;
  expiry: string;
  bearer: string;
  // Refcount. The same (symbol, expiry) may be requested by multiple downstream
  // clients; we maintain one upstream WS for all of them.
  refCount: number;
  // Latest fully-merged chain. Built from REST cold-load + WS delta merges.
  rowsByStrike: Map<number, OptionChainRow>;
  underlyingValue: number;
  asof: number;
  // Cold-load watermark. WS frames whose `asof` <= this are dropped to avoid
  // overwriting freshly loaded REST data with stale buffered WS frames.
  coldLoadAsof: number;
  ws: WebSocket | null;
  // Reconnect bookkeeping.
  reconnectAttempt: number;
  reconnectTimer: NodeJS.Timeout | null;
  closing: boolean;
  // Fan-out.
  snapshotListeners: Set<SnapshotListener>;
  errorListeners: Set<ErrorListener>;
}

const subs = new Map<string, Subscription>();

function key(symbol: string, expiry: string): string {
  return `${symbol}.${expiry}`;
}

// Exponential backoff capped at 30 s. attempt is 0-based (first reconnect → 1 s).
function backoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * Math.pow(2, attempt));
}

function buildSnapshotFromSub(sub: Subscription): OptionChainSnapshot {
  const rows = [...sub.rowsByStrike.values()].sort((a, b) => a.strikePrice - b.strikePrice);
  return {
    symbol: sub.symbol,
    expiryDate: sub.expiry,
    underlyingValue: sub.underlyingValue,
    fetchedAt: sub.asof,
    rows,
  };
}

function mergeRow(sub: Subscription, s: TradlStrike): void {
  // Re-flatten the leg into our row shape, then carry forward any greeks the
  // upstream frame omitted. Per FRONTEND_INTEGRATION.md the gateway always
  // sends the full leg shape per changed strike, but greeks lag the option
  // tick by up to ~30 s — they may be 0/null for fresh strikes between
  // greeks recompute cycles.
  const prev = sub.rowsByStrike.get(s.strike);
  const next = flattenStrike(s, sub.underlyingValue, sub.expiry);
  if (prev) {
    for (const g of ['call_delta', 'call_gamma', 'call_theta', 'call_vega',
                     'put_delta',  'put_gamma',  'put_theta',  'put_vega'] as const) {
      if (next[g] === 0 && prev[g] !== 0) next[g] = prev[g];
    }
  }
  sub.rowsByStrike.set(s.strike, next);
}

function broadcastSnapshot(sub: Subscription): void {
  const snap = buildSnapshotFromSub(sub);
  for (const l of sub.snapshotListeners) {
    try { l(snap); } catch (err) {
      console.error(`[tradl-source ${sub.symbol}.${sub.expiry}] listener threw:`, err);
    }
  }
}

function broadcastError(sub: Subscription, err: Error): void {
  for (const l of sub.errorListeners) {
    try { l(err); } catch (_e) { /* ignore */ }
  }
}

async function connect(sub: Subscription): Promise<void> {
  if (sub.closing) return;

  let token: string;
  try {
    token = await mintWsToken(sub.bearer);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`[tradl-source ${sub.symbol}.${sub.expiry}] token mint failed: ${e.message}`);
    broadcastError(sub, e);
    scheduleReconnect(sub);
    return;
  }

  const ws = new WebSocket(WS_BASE, [`bearer.${token}`]);
  sub.ws = ws;

  const channel = `option_chain.${sub.symbol}.${sub.expiry}`;

  const subKey = `${sub.symbol}.${sub.expiry}`;

  ws.on('open', () => {
    console.log(`[tradl-source ${subKey}] WS open, subscribing`);
    const subscribeFrame = {
      id: 1,
      method: 'subscribe',
      params: { channels: [channel] },
    };
    logFrame('→ SEND', subKey, subscribeFrame);
    ws.send(JSON.stringify(subscribeFrame));
    // Cold-load AFTER subscribe so we don't miss frames in the gap between
    // REST response and SUBSCRIBE reply.
    void doColdLoad(sub);
  });

  ws.on('message', (data) => {
    let msg: unknown;
    try { msg = JSON.parse(data.toString()); }
    catch (err) {
      console.warn(`[tradl-source ${subKey}] bad JSON frame:`, err);
      return;
    }
    logFrame('← RECV', subKey, msg);
    handleFrame(sub, msg as Record<string, unknown>);
  });

  ws.on('close', (code, reasonBuf) => {
    const reason = reasonBuf.toString();
    console.warn(`[tradl-source ${sub.symbol}.${sub.expiry}] WS close ${code} ${reason}`);
    sub.ws = null;
    if (sub.closing) return;
    // 4401 = token expired / unauthorized → flush and re-mint on reconnect.
    if (code === 4401) invalidateWsToken();
    scheduleReconnect(sub);
  });

  ws.on('error', (err) => {
    console.warn(`[tradl-source ${sub.symbol}.${sub.expiry}] WS error: ${err.message}`);
    // 'close' will follow.
  });
}

async function doColdLoad(sub: Subscription): Promise<void> {
  try {
    const snap = await coldLoadChain(sub.symbol, sub.expiry, sub.bearer);
    sub.coldLoadAsof = snap.fetchedAt;
    sub.underlyingValue = snap.underlyingValue;
    sub.asof = snap.fetchedAt;
    sub.rowsByStrike.clear();
    for (const r of snap.rows) sub.rowsByStrike.set(r.strikePrice, r);
    broadcastSnapshot(sub);
    console.log(`[tradl-source ${sub.symbol}.${sub.expiry}] cold-load: ${snap.rows.length} strikes, spot ${snap.underlyingValue}`);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`[tradl-source ${sub.symbol}.${sub.expiry}] cold-load failed: ${e.message}`);
    broadcastError(sub, e);
  }
}

function handleFrame(sub: Subscription, msg: Record<string, unknown>): void {
  // Replies have `id`; events have `c`. Ignore replies after logging.
  if (typeof msg.id !== 'undefined') {
    if (msg.result) {
      const result = msg.result as { subscribed?: string[]; denied?: Array<{ channel: string; reason: string }> };
      if (result.denied?.length) {
        const e = new Error(`Gateway denied: ${result.denied.map((d) => `${d.channel} (${d.reason})`).join(', ')}`);
        broadcastError(sub, e);
      }
    }
    return;
  }
  const channel = typeof msg.c === 'string' ? msg.c : '';
  if (!channel.startsWith(`option_chain.${sub.symbol}.${sub.expiry}`)) return;
  const payload = msg.d as TradlChainEnvelope | undefined;
  if (!payload) return;

  // Race protection: drop frames stamped at-or-before the last cold-load.
  const frameAsof = typeof payload.asof === 'number' ? payload.asof : Date.now();
  if (frameAsof <= sub.coldLoadAsof) return;

  // Update spot + asof always. Strikes[] may be empty (underlying-only tick).
  if (typeof payload.underlying_ltp === 'number' && Number.isFinite(payload.underlying_ltp)) {
    sub.underlyingValue = payload.underlying_ltp;
  }
  sub.asof = frameAsof;

  if (Array.isArray(payload.strikes)) {
    for (const s of payload.strikes) mergeRow(sub, s);
  }
  broadcastSnapshot(sub);
}

function scheduleReconnect(sub: Subscription): void {
  if (sub.closing || sub.reconnectTimer) return;
  const delay = backoffMs(sub.reconnectAttempt);
  sub.reconnectAttempt += 1;
  console.log(`[tradl-source ${sub.symbol}.${sub.expiry}] reconnect in ${delay}ms (attempt ${sub.reconnectAttempt})`);
  sub.reconnectTimer = setTimeout(() => {
    sub.reconnectTimer = null;
    void connect(sub);
  }, delay);
}

function teardown(sub: Subscription): void {
  sub.closing = true;
  if (sub.reconnectTimer) {
    clearTimeout(sub.reconnectTimer);
    sub.reconnectTimer = null;
  }
  if (sub.ws) {
    const subKey = `${sub.symbol}.${sub.expiry}`;
    const unsubFrame = {
      id: 2,
      method: 'unsubscribe',
      params: { channels: [`option_chain.${sub.symbol}.${sub.expiry}`] },
    };
    try {
      logFrame('→ SEND', subKey, unsubFrame);
      sub.ws.send(JSON.stringify(unsubFrame));
    } catch { /* socket may already be closed */ }
    sub.ws.close(1000, 'subscription ended');
    sub.ws = null;
  }
  sub.snapshotListeners.clear();
  sub.errorListeners.clear();
  subs.delete(key(sub.symbol, sub.expiry));
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface SubscribeOptions {
  symbol: string;
  expiry: string;
  bearer: string;
  onSnapshot: SnapshotListener;
  onError?: ErrorListener;
}

// Open (or join an existing) upstream subscription. Returns a function the
// caller invokes to drop their interest. When the last consumer drops, the
// upstream WS closes.
export function subscribeChain(opts: SubscribeOptions): () => void {
  const k = key(opts.symbol, opts.expiry);
  let sub = subs.get(k);
  if (!sub) {
    sub = {
      symbol: opts.symbol,
      expiry: opts.expiry,
      bearer: opts.bearer,
      refCount: 0,
      rowsByStrike: new Map(),
      underlyingValue: 0,
      asof: 0,
      coldLoadAsof: 0,
      ws: null,
      reconnectAttempt: 0,
      reconnectTimer: null,
      closing: false,
      snapshotListeners: new Set(),
      errorListeners: new Set(),
    };
    subs.set(k, sub);
    void connect(sub);
  } else {
    // If a cached snapshot exists, push it to the new listener immediately
    // so it doesn't have to wait for the next upstream frame.
    if (sub.rowsByStrike.size > 0) {
      try { opts.onSnapshot(buildSnapshotFromSub(sub)); } catch { /* ignore */ }
    }
  }
  sub.refCount += 1;
  sub.snapshotListeners.add(opts.onSnapshot);
  if (opts.onError) sub.errorListeners.add(opts.onError);

  return () => {
    if (!sub) return;
    sub.snapshotListeners.delete(opts.onSnapshot);
    if (opts.onError) sub.errorListeners.delete(opts.onError);
    sub.refCount -= 1;
    if (sub.refCount <= 0) teardown(sub);
  };
}

export async function fetchExpiriesViaTradl(symbol: string, bearer: string): Promise<string[]> {
  return listExpiries(symbol, bearer);
}
