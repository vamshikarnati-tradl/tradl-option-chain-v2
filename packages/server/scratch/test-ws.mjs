// One-off smoke test for the TRADL WS gateway. Mints a ws_token, fetches the
// option-chain snapshot, then opens a WS, subscribes to the chain + greeks
// channels for one near-ATM strike, logs ~15s of frames, and exits.
//
// Run from packages/server so node resolves the `ws` dependency:
//   cd packages/server && BEARER="..." EXPIRY="2026-05-14" node /tmp/test-ws.mjs

import WebSocket from 'ws';

const REST = process.env.TRADL_GATEWAY_REST   ?? 'http://13.203.178.90:9096';
const WSU  = process.env.TRADL_GATEWAY_WS     ?? 'ws://13.203.178.90:9097/v1/stream';
const UND  = process.env.UNDERLYING            ?? 'NIFTY';
const EXP  = process.env.EXPIRY                ?? '2026-05-14';
const BEAR = process.env.TRADL_GATEWAY_BEARER ?? process.env.BEARER;

if (!BEAR) {
  console.error('Missing TRADL_GATEWAY_BEARER env var');
  process.exit(1);
}

const log = (label, obj) =>
  console.log(`\n[${label}]`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));

// ──────────────── 1. Mint WS token ────────────────

console.log(`POST ${REST}/v1/auth/ws-token`);
const tokRes = await fetch(`${REST}/v1/auth/ws-token`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${BEAR}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
});
if (!tokRes.ok) {
  console.error(`ws-token failed: ${tokRes.status} ${tokRes.statusText}`);
  console.error(await tokRes.text());
  process.exit(2);
}
const tokJson = await tokRes.json();
const wsToken = tokJson.token;
log('ws-token', { ok: true, tokenPrefix: wsToken.slice(0, 24) + '…' });

// ──────────────── 2. REST snapshot (peek shape) ────────────────

const snapUrl = `${REST}/v1/option-chain/${UND}?expiry=${EXP}`;
console.log(`\nGET ${snapUrl}`);
const snapRes = await fetch(snapUrl, {
  headers: { 'Authorization': `Bearer ${BEAR}` },
});
if (!snapRes.ok) {
  console.error(`option-chain failed: ${snapRes.status} ${snapRes.statusText}`);
  console.error(await snapRes.text());
  process.exit(3);
}
const snap = await snapRes.json();

const topKeys = Object.keys(snap);
const strikes = Array.isArray(snap.strikes) ? snap.strikes : [];
const sampleStrike = strikes[0] ?? null;
log('snapshot.shape', {
  topKeys,
  strikeCount: strikes.length,
  sampleStrikeKeys: sampleStrike ? Object.keys(sampleStrike) : null,
  sampleCeKeys: sampleStrike?.ce ? Object.keys(sampleStrike.ce) : null,
});
log('snapshot.meta', {
  underlying: snap.underlying, expiry: snap.expiry,
  underlying_ltp: snap.underlying_ltp, asof: snap.asof,
});
if (sampleStrike) log('snapshot.strike[0]', sampleStrike);

// Pick a near-ATM strike from the REST snapshot. If underlying_ltp is null,
// pick the strike whose CE delta is closest to 0.5 (ATM definition).
function pickAtm(strikes, spot) {
  if (spot != null && Number.isFinite(spot)) {
    let best = strikes[0]; let bestDist = Infinity;
    for (const s of strikes) {
      const d = Math.abs(s.strike - spot);
      if (d < bestDist) { best = s; bestDist = d; }
    }
    return best;
  }
  // Fallback: closest |delta - 0.5| on the CE leg.
  let best = strikes[0]; let bestDist = Infinity;
  for (const s of strikes) {
    const delta = s.ce?.delta;
    if (typeof delta !== 'number') continue;
    const d = Math.abs(delta - 0.5);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}
const atm = pickAtm(strikes, snap.underlying_ltp);
log('atm.candidate', atm ? {
  strike: atm.strike,
  ceSymbol: atm.ce?.symbol, peSymbol: atm.pe?.symbol,
  ceDelta: atm.ce?.delta, peDelta: atm.pe?.delta,
  ceIv: atm.ce?.iv, peIv: atm.pe?.iv,
} : null);

const ceSymbol = atm?.ce?.symbol ?? null;
const peSymbol = atm?.pe?.symbol ?? null;
log('symbol.final', { ce: ceSymbol, pe: peSymbol });

// ──────────────── 3. Open WS ────────────────

const ws = new WebSocket(WSU, [`bearer.${wsToken}`]);
const seen = { reply: 0, event: 0, byChannel: {} };
let optionChainCount = 0;
let greeksCount = 0;

ws.on('open', () => {
  log('ws.open', { url: WSU });
  // Subscribe to the option_chain channel (chain deltas).
  const subChain = {
    id: 1, method: 'subscribe',
    params: { channels: [`option_chain.${UND}.${EXP}`] },
  };
  log('ws.send', subChain);
  ws.send(JSON.stringify(subChain));

  // Subscribe to greeks for the ATM CE + PE legs.
  const greekChannels = [];
  if (ceSymbol) greekChannels.push(`greeks.NFO.${ceSymbol}`);
  if (peSymbol) greekChannels.push(`greeks.NFO.${peSymbol}`);
  if (greekChannels.length) {
    const subGreeks = {
      id: 2, method: 'subscribe',
      params: { channels: greekChannels },
    };
    log('ws.send', subGreeks);
    ws.send(JSON.stringify(subGreeks));
  }
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); }
  catch (e) { log('ws.parse-error', String(e)); return; }

  if (typeof msg.id !== 'undefined') {
    seen.reply++;
    log(`reply#${msg.id}`, msg);
    return;
  }
  seen.event++;
  const ch = msg.c ?? '(no-channel)';
  seen.byChannel[ch] = (seen.byChannel[ch] ?? 0) + 1;

  // Throttle option_chain logs (high-volume), keep first 3 + every 10th.
  if (ch.startsWith('option_chain.')) {
    optionChainCount++;
    if (optionChainCount <= 3 || optionChainCount % 10 === 0) {
      log(`event ${ch} #${optionChainCount}`, msg);
    }
  } else if (ch.startsWith('greeks.')) {
    greeksCount++;
    log(`event ${ch} #${greeksCount}`, msg);
  } else {
    log(`event ${ch}`, msg);
  }
});

ws.on('close', (code, reason) => {
  log('ws.close', { code, reason: reason.toString() });
  log('summary', { ...seen, optionChainCount, greeksCount });
});

ws.on('error', (err) => {
  log('ws.error', String(err));
});

// Run for 20s then close.
const DURATION_MS = Number(process.env.DURATION_MS ?? 20000);
setTimeout(() => {
  log('timer', `closing after ${DURATION_MS}ms`);
  ws.close(1000, 'test complete');
  // Give the close handler a moment.
  setTimeout(() => process.exit(0), 300);
}, DURATION_MS);
