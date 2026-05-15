import express from 'express';
import cors from 'cors';
import http from 'http';
import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchOptionChain, fetchExpiries } from './nse-fetcher.js';
import { buildSnapshot } from './data-transformer.js';
import { buildMockSnapshot, getMockExpiries } from './mock-source.js';
import { parseAi, AIValidationError, type AIParseRequest } from './ai-parse.js';
import { refineExpression, type RefineRequest } from './ai-refine-expression.js';
import { setLatestSnapshot } from './snapshot-store.js';
import { subscribeChain, fetchExpiriesViaTradl } from './tradl-source.js';
import type { OptionChainSnapshot, WsServerMessage } from './types.js';

// Keep the server alive when a downstream socket dies mid-write (EPIPE) or a
// background promise rejects. Without these, a single failed AI parse with a
// disconnected client crashes the process and the data WS goes with it.
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EPIPE' || code === 'ECONNRESET') {
    console.warn(`[server] benign socket error: ${code}`);
    return;
  }
  console.error('[server] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});

type DataSource = 'nse' | 'mock' | 'tradl-gateway';

const PORT = Number(process.env.PORT ?? 4000);
const REQUESTED_SOURCE = (process.env.DATA_SOURCE ?? 'tradl-gateway').toLowerCase() as DataSource;
const TRADL_BEARER = process.env.TRADL_GATEWAY_BEARER ?? '';
// If gateway is requested but no bearer is configured, demote to mock so dev
// can still boot. We warn loudly — operator can override by setting the bearer.
const DATA_SOURCE: DataSource =
  REQUESTED_SOURCE === 'tradl-gateway' && !TRADL_BEARER ? 'mock' : REQUESTED_SOURCE;
if (REQUESTED_SOURCE === 'tradl-gateway' && !TRADL_BEARER) {
  console.warn('[server] DATA_SOURCE=tradl-gateway requested but TRADL_GATEWAY_BEARER missing — using mock');
}
const DEFAULT_POLL = DATA_SOURCE === 'nse' ? 60_000 : 2_000;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? DEFAULT_POLL);
// Cadence of the mock fallback while gateway is down. Keep it tight so the
// user sees something moving even when upstream is unreachable.
const FALLBACK_POLL_MS = 2_000;
const SUPPORTED_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

async function fetchPrimarySnapshot(symbol: string, expiryDate?: string): Promise<OptionChainSnapshot> {
  if (DATA_SOURCE === 'nse') {
    const raw = await fetchOptionChain(symbol);
    return buildSnapshot(symbol, raw, expiryDate);
  }
  return buildMockSnapshot(symbol, expiryDate);
}

async function listExpiries(symbol: string): Promise<string[]> {
  if (DATA_SOURCE === 'tradl-gateway') {
    try {
      return await fetchExpiriesViaTradl(symbol, TRADL_BEARER);
    } catch (err) {
      console.warn(`[${symbol}] tradl-gateway expiries failed, serving mock expiries: ${err instanceof Error ? err.message : err}`);
      return getMockExpiries(symbol);
    }
  }
  if (DATA_SOURCE === 'nse') return fetchExpiries(symbol);
  return getMockExpiries(symbol);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

interface SymbolState {
  latest: OptionChainSnapshot | null;
  latestError: string | null;
  subscribers: Set<WebSocket>;
  // setInterval handle for the primary mock/nse poll loop OR the mock-fallback
  // loop that runs while the gateway is unhealthy.
  pollHandle: NodeJS.Timeout | null;
  // Refcounted unsubscribe callback returned by `subscribeChain` from the
  // TRADL upstream WS manager. null for mock/nse and before gateway start.
  streamStop: (() => void) | null;
}

const state = new Map<string, SymbolState>();

function getState(symbol: string): SymbolState {
  let s = state.get(symbol);
  if (!s) {
    s = {
      latest: null, latestError: null,
      subscribers: new Set(),
      pollHandle: null,
      streamStop: null,
    };
    state.set(symbol, s);
  }
  return s;
}

function handleSnapshot(symbol: string, snapshot: OptionChainSnapshot): void {
  const s = getState(symbol);
  s.latest = snapshot;
  s.latestError = null;
  setLatestSnapshot(symbol, snapshot);
  broadcast(symbol, { type: 'snapshot', payload: snapshot });
  // A successful gateway snapshot means the upstream is healthy — tear down
  // any mock-fallback loop that may have been started during an outage.
  if (snapshot.source === 'tradl-gateway') stopMockFallback(symbol);
}

function handleSourceError(symbol: string, err: unknown): void {
  const s = getState(symbol);
  const message = err instanceof Error ? err.message : String(err);
  s.latestError = message;
  console.error(`[${symbol}] data source error: ${message}`);
  broadcast(symbol, { type: 'error', message });
}

async function pollOnce(symbol: string, expiryDate?: string): Promise<void> {
  try {
    const snapshot = await fetchPrimarySnapshot(symbol, expiryDate);
    handleSnapshot(symbol, snapshot);
    console.log(
      `[${symbol}] snapshot ${snapshot.rows.length} strikes, expiry ${snapshot.expiryDate}, spot ${snapshot.underlyingValue}`,
    );
  } catch (err) {
    handleSourceError(symbol, err);
  }
}

// Mock fallback — runs in parallel with the gateway subscription when the
// gateway is unreachable. A successful gateway snapshot stops it; the gateway
// keeps trying to reconnect with its own internal backoff in the meantime.
async function pollMockOnce(symbol: string): Promise<void> {
  try {
    const snap = buildMockSnapshot(symbol);
    handleSnapshot(symbol, snap);
  } catch (err) {
    // Mock generation shouldn't fail, but log just in case.
    console.error(`[${symbol}] mock fallback error:`, err);
  }
}

function startMockFallback(symbol: string): void {
  const s = getState(symbol);
  if (s.pollHandle) return;
  console.warn(`[${symbol}] starting mock fallback — gateway unavailable`);
  void pollMockOnce(symbol);
  s.pollHandle = setInterval(() => void pollMockOnce(symbol), FALLBACK_POLL_MS);
}

function stopMockFallback(symbol: string): void {
  const s = state.get(symbol);
  if (!s || !s.pollHandle) return;
  // Only stop the fallback when we're configured for gateway — in mock/nse
  // mode pollHandle IS the primary poll loop and must not be cleared on every
  // snapshot.
  if (DATA_SOURCE !== 'tradl-gateway') return;
  clearInterval(s.pollHandle);
  s.pollHandle = null;
  console.log(`[${symbol}] gateway recovered — mock fallback stopped`);
}

async function startStream(symbol: string): Promise<void> {
  const s = getState(symbol);
  if (s.pollHandle || s.streamStop) return;

  if (DATA_SOURCE === 'tradl-gateway') {
    // Pick the nearest available expiry. Future: let clients pass an expiry
    // hint on subscribe.
    let expiry: string | null = null;
    try {
      const expiries = await fetchExpiriesViaTradl(symbol, TRADL_BEARER);
      if (!expiries.length) throw new Error('no expiries available');
      expiry = expiries[0];
    } catch (err) {
      // Can't even reach the gateway REST endpoint. Start the mock fallback
      // immediately so the client sees something.
      console.warn(`[${symbol}] gateway expiries fetch failed: ${err instanceof Error ? err.message : err}`);
      startMockFallback(symbol);
    }
    if (expiry) {
      s.streamStop = subscribeChain({
        symbol,
        expiry,
        bearer: TRADL_BEARER,
        onSnapshot: (snap) => handleSnapshot(symbol, snap),
        // Don't propagate gateway errors to the client — keep them server-side
        // and let the mock fallback take over silently. The UI distinguishes
        // mock vs gateway via snapshot.source.
        onError:    (err)  => {
          console.warn(`[${symbol}] gateway stream error: ${err.message} — starting mock fallback`);
          startMockFallback(symbol);
        },
      });
      console.log(`[${symbol}] streaming from tradl-gateway, expiry ${expiry}`);
    }
    return;
  }

  // mock / nse — poll loop.
  void pollOnce(symbol);
  s.pollHandle = setInterval(() => void pollOnce(symbol), POLL_INTERVAL_MS);
  console.log(`[${symbol}] polling started @ ${POLL_INTERVAL_MS}ms`);
}

function stopStreamIfIdle(symbol: string): void {
  const s = state.get(symbol);
  if (!s || s.subscribers.size > 0) return;
  if (s.pollHandle) {
    clearInterval(s.pollHandle);
    s.pollHandle = null;
    console.log(`[${symbol}] polling stopped (no subscribers)`);
  }
  if (s.streamStop) {
    s.streamStop();
    s.streamStop = null;
    console.log(`[${symbol}] stream stopped (no subscribers)`);
  }
}

function broadcast(symbol: string, msg: WsServerMessage): void {
  const s = state.get(symbol);
  if (!s) return;
  const payload = JSON.stringify(msg);
  for (const ws of s.subscribers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), aiConfigured: !!process.env.ANTHROPIC_API_KEY });
});

app.post('/api/ai/parse', async (req, res) => {
  const body = req.body as Partial<AIParseRequest> | undefined;
  if (!body?.input || typeof body.input !== 'string') {
    return res.status(400).json({ error: 'input (string) is required' });
  }
  if (body.input.length > 1000) {
    return res.status(400).json({ error: 'input is too long (max 1000 chars)' });
  }
  try {
    const symbol = typeof body.symbol === 'string' ? body.symbol.toUpperCase() : undefined;
    const result = await parseAi({
      input: body.input,
      index: body.index,
      columns: Array.isArray(body.columns) ? body.columns : [],
      existingRules: Array.isArray(body.existingRules) ? body.existingRules : [],
      symbol,
      state: body.state,
    });
    if (res.writableEnded) return;
    res.json(result);
  } catch (err) {
    if (res.writableEnded) return;
    if (err instanceof AIValidationError) {
      console.warn(`[ai/parse] validation failed: ${err.detail}`);
      return res.status(422).json({ error: err.userError, detail: err.detail });
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'AI is not configured on the server (set ANTHROPIC_API_KEY)' });
    }
    console.error('[ai/parse] failed:', message);
    res.status(502).json({ error: message });
  }
});

app.post('/api/ai/refine-expression', async (req, res) => {
  const body = req.body as Partial<RefineRequest> | undefined;
  if (!body?.currentExpression || typeof body.currentExpression !== 'string') {
    return res.status(400).json({ error: 'currentExpression (string) is required' });
  }
  if (!body.instruction || typeof body.instruction !== 'string') {
    return res.status(400).json({ error: 'instruction (string) is required' });
  }
  if (body.currentExpression.length > 1000 || body.instruction.length > 500) {
    return res.status(400).json({ error: 'inputs are too long' });
  }
  try {
    const symbol = typeof body.symbol === 'string' ? body.symbol.toUpperCase() : undefined;
    const kind = body.kind === 'column' ? 'column' : 'rule';
    const result = await refineExpression({
      currentExpression: body.currentExpression,
      instruction: body.instruction,
      index: body.index,
      columns: Array.isArray(body.columns) ? body.columns : [],
      symbol,
      kind,
      state: body.state,
    });
    if (res.writableEnded) return;
    res.json(result);
  } catch (err) {
    if (res.writableEnded) return;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'AI is not configured on the server (set ANTHROPIC_API_KEY)' });
    }
    const e = err as Error & { detail?: string };
    if (e.detail) {
      console.warn(`[ai/refine-expression] validation failed: ${e.detail}`);
      return res.status(422).json({ error: message, detail: e.detail });
    }
    console.error('[ai/refine-expression] failed:', message);
    res.status(502).json({ error: message });
  }
});

app.get('/api/symbols', (_req, res) => {
  res.json({ symbols: SUPPORTED_SYMBOLS });
});

app.get('/api/expiries/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!SUPPORTED_SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: `Unsupported symbol ${symbol}` });
  }
  try {
    const expiries = await listExpiries(symbol);
    res.json({ symbol, expiries });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/option-chain/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!SUPPORTED_SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: `Unsupported symbol ${symbol}` });
  }
  const expiryDate = typeof req.query.expiry === 'string' ? req.query.expiry : undefined;
  try {
    // In gateway mode the WS manager owns the live snapshot — return its
    // cached view rather than minting a parallel REST cold-load. Mock/NSE
    // modes have no equivalent cache, so we hit the primary directly.
    const cached = state.get(symbol)?.latest;
    const snapshot = cached && !expiryDate ? cached : await fetchPrimarySnapshot(symbol, expiryDate);
    res.json(snapshot);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// In production, serve the built client from packages/client/dist (Railway and
// other single-service deploys). Skipped in dev — Vite owns those files.
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(join(clientDist, 'index.html'));
  });
  console.log(`[server] serving client from ${clientDist}`);
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/ws\/option-chain\/([A-Za-z]+)$/);
  if (!match) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  const symbol = match[1].toUpperCase();
  if (!SUPPORTED_SYMBOLS.includes(symbol)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, symbol);
  });
});

wss.on('connection', (ws: WebSocket, _req: IncomingMessage, symbol: string) => {
  const s = getState(symbol);
  s.subscribers.add(ws);
  console.log(`[${symbol}] ws connected (subs=${s.subscribers.size})`);

  if (s.latest) {
    ws.send(JSON.stringify({ type: 'snapshot', payload: s.latest } satisfies WsServerMessage));
  } else if (s.latestError) {
    ws.send(JSON.stringify({ type: 'error', message: s.latestError } satisfies WsServerMessage));
  }

  void startStream(symbol);

  ws.on('close', () => {
    s.subscribers.delete(ws);
    console.log(`[${symbol}] ws disconnected (subs=${s.subscribers.size})`);
    stopStreamIfIdle(symbol);
  });

  ws.on('error', (err) => {
    console.error(`[${symbol}] ws error:`, err);
  });
});

server.listen(PORT, () => {
  console.log(`tradl-server listening on http://localhost:${PORT}`);
  if (DATA_SOURCE === 'tradl-gateway') {
    console.log(`  data source: tradl-gateway (mock fallback @ ${FALLBACK_POLL_MS}ms on error)`);
  } else {
    console.log(`  data source: ${DATA_SOURCE}, poll interval: ${POLL_INTERVAL_MS}ms`);
  }
});
