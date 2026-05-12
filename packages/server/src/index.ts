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
import { setLatestSnapshot } from './snapshot-store.js';
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

const PORT = Number(process.env.PORT ?? 4000);
const DATA_SOURCE = (process.env.DATA_SOURCE ?? 'mock').toLowerCase() as 'nse' | 'mock';
const DEFAULT_POLL = DATA_SOURCE === 'mock' ? 2_000 : 60_000;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? DEFAULT_POLL);
const SUPPORTED_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

async function fetchSnapshot(symbol: string, expiryDate?: string): Promise<OptionChainSnapshot> {
  if (DATA_SOURCE === 'nse') {
    const raw = await fetchOptionChain(symbol);
    return buildSnapshot(symbol, raw, expiryDate);
  }
  return buildMockSnapshot(symbol, expiryDate);
}

async function listExpiries(symbol: string): Promise<string[]> {
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
  pollHandle: NodeJS.Timeout | null;
}

const state = new Map<string, SymbolState>();

function getState(symbol: string): SymbolState {
  let s = state.get(symbol);
  if (!s) {
    s = { latest: null, latestError: null, subscribers: new Set(), pollHandle: null };
    state.set(symbol, s);
  }
  return s;
}

async function pollOnce(symbol: string, expiryDate?: string): Promise<void> {
  const s = getState(symbol);
  try {
    const snapshot = await fetchSnapshot(symbol, expiryDate);
    s.latest = snapshot;
    s.latestError = null;
    setLatestSnapshot(symbol, snapshot);
    broadcast(symbol, { type: 'snapshot', payload: snapshot });
    console.log(
      `[${symbol}] snapshot ${snapshot.rows.length} strikes, expiry ${snapshot.expiryDate}, spot ${snapshot.underlyingValue}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    s.latestError = message;
    console.error(`[${symbol}] poll failed: ${message}`);
    broadcast(symbol, { type: 'error', message });
  }
}

function startPolling(symbol: string): void {
  const s = getState(symbol);
  if (s.pollHandle) return;
  void pollOnce(symbol);
  s.pollHandle = setInterval(() => void pollOnce(symbol), POLL_INTERVAL_MS);
  console.log(`[${symbol}] polling started @ ${POLL_INTERVAL_MS}ms`);
}

function stopPollingIfIdle(symbol: string): void {
  const s = state.get(symbol);
  if (!s || s.subscribers.size > 0) return;
  if (s.pollHandle) {
    clearInterval(s.pollHandle);
    s.pollHandle = null;
    console.log(`[${symbol}] polling stopped (no subscribers)`);
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
      availableFields: Array.isArray(body.availableFields) ? body.availableFields : [],
      existingRules: Array.isArray(body.existingRules) ? body.existingRules : [],
      existingColumns: Array.isArray(body.existingColumns) ? body.existingColumns : [],
      symbol,
    });
    if (res.writableEnded) return;
    res.json(result);
  } catch (err) {
    if (res.writableEnded) return;
    if (err instanceof AIValidationError) {
      console.warn(`[ai/parse] validation failed: ${err.detail}`);
      return res.status(422).json({ error: err.userError, detail: err.detail, draft: err.draft });
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'AI is not configured on the server (set ANTHROPIC_API_KEY)' });
    }
    console.error('[ai/parse] failed:', message);
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
    const snapshot = await fetchSnapshot(symbol, expiryDate);
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

  startPolling(symbol);

  ws.on('close', () => {
    s.subscribers.delete(ws);
    console.log(`[${symbol}] ws disconnected (subs=${s.subscribers.size})`);
    stopPollingIfIdle(symbol);
  });

  ws.on('error', (err) => {
    console.error(`[${symbol}] ws error:`, err);
  });
});

server.listen(PORT, () => {
  console.log(`tradl-server listening on http://localhost:${PORT}`);
  console.log(`  data source: ${DATA_SOURCE}, poll interval: ${POLL_INTERVAL_MS}ms`);
});
