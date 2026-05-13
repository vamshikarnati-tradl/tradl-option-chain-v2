# Option Chain & Option Leg — Frontend Integration Guide

This is the **shipped** contract. Where it disagrees with `BACKEND_SCHEMA_PROPOSAL.md`, this doc wins.

Companion: [`FIELD_UNITS.ts`](FIELD_UNITS.ts) is still the machine-readable field spec — the `assertSurface` validators continue to work, you just point them at `instrument_envelope` / `instrument_leg` / `symbol_payload` against payloads from the names below.

---

## TL;DR — what to wire up

| Surface | Use for | Endpoint |
|---|---|---|
| REST | Cold-load the whole chain | `GET /v1/option-chain/{underlying}/{expiry}` |
| WS   | Live chain deltas (~250 ms) | `option_chain.{underlying}.{expiry}` |
| REST | Cold-load a single leg | `GET /v1/option-leg/{symbol}/{expiry}` |
| WS   | Live single-leg deltas (~250 ms) | `option_leg.{symbol}.{expiry}` |

**Removed** (don't call these anymore — they're gone):
- `GET /v1/option-chain/{u}?expiry=…` → moved to path-segment form above.
- `GET /v1/greeks/{symbol}` → use `/v1/option-leg/{symbol}/{expiry}`.
- WS `greeks.NFO.{symbol}` → use `option_leg.{symbol}.{expiry}` (greeks travel inside every chain + leg payload now).

**Naming deviations from the proposal** (these were intentional — the proposal's names collided with existing vocabulary in the codebase):
- We kept `option_chain.*` for the chain channel (the proposal asked for `instrument.*`).
- The per-leg channel is `option_leg.*` (the proposal asked for `symbols.*`).
- REST routes mirror those names (`/v1/option-chain/…` and `/v1/option-leg/…`).

Everything else in your spec (snake_case, nested `ce`/`pe`, `iv` as percent, `asof` as ms epoch, identity fields on every payload, greeks per leg in every payload) shipped as-is.

---

## Wire shape

### 1. Chain — `GET /v1/option-chain/{u}/{expiry}` and WS `option_chain.{u}.{expiry}`

REST body and WS frame `d` carry the same envelope. WS frames also have outer `c` (channel) and `t` (server-emit timestamp ms epoch):

```json
{
  "underlying": "NIFTY",
  "expiry": "2026-05-29",
  "underlying_ltp": 24050.50,
  "asof": 1778646991462,
  "strikes": [
    {
      "strike": 24000,
      "ce": {
        "symbol": "NIFTY2026-05-2924000CE",
        "exchange": "NFO",
        "ltp": 200.50,
        "volume": 9999,
        "oi": 1050,
        "oi_change": 50,
        "net_change": 10.50,
        "bid_qty": 10, "bid_price": 200.00,
        "ask_qty": 12, "ask_price": 201.00,
        "iv": 18.00,
        "delta": 0.55, "gamma": 0.001, "theta": -12.30, "vega": 9.50
      },
      "pe": {
        "symbol": "NIFTY2026-05-2924000PE",
        "exchange": "NFO",
        "ltp": 55.50, "volume": 1000, "oi": 1900, "oi_change": -100,
        "net_change": -0.50,
        "bid_qty": null, "bid_price": null,
        "ask_qty": null, "ask_price": null,
        "iv": 19.00,
        "delta": -0.45, "gamma": 0.001, "theta": -11.20, "vega": 9.30
      }
    }
  ]
}
```

**WS delta semantics**: a WS frame's `strikes[]` carries only the strikes that changed since the last drain. Merge by `strike` key into your in-memory model. When only the underlying ticks and no leg has changed, you'll still get a frame with the refreshed `underlying_ltp` and `strikes: []` — use it to update your spot ticker.

**Strike-with-only-one-side**: `ce` or `pe` may be `null` (object null) when only one side of that strike is listed.

### 2. Leg — `GET /v1/option-leg/{symbol}/{expiry}` and WS `option_leg.{symbol}.{expiry}`

Flat per-leg shape. Same fields as the chain leg block, plus identity context hoisted to the top:

```json
{
  "symbol": "NIFTY2026-05-2924000CE",
  "exchange": "NFO",
  "underlying": "NIFTY",
  "expiry": "2026-05-29",
  "strike": 24000,
  "side": "ce",
  "underlying_ltp": 24050.50,
  "asof": 1778646991462,

  "ltp": 200.50,
  "volume": 9999,
  "oi": 1050,
  "oi_change": 50,
  "net_change": 10.50,
  "bid_qty": 10, "bid_price": 200.00,
  "ask_qty": 12, "ask_price": 201.00,

  "iv": 18.00,
  "delta": 0.55, "gamma": 0.001, "theta": -12.30, "vega": 9.50
}
```

**Cadence**: ~250 ms. Greeks (`iv`, `delta`, `gamma`, `theta`, `vega`) carry the most recent computed values (≤30 s stale at worst — greeks recompute on a 30 s upstream cycle).

---

## Field reference

Per-leg, every surface. Same fields, same units in REST and WS.

| Field | Type | Unit | Null? | Notes |
|---|---|---|---|---|
| `symbol` | string | tradingsymbol | no | NFO tradingsymbol, e.g. `NIFTY2026-05-2924000CE`. |
| `exchange` | string | `NFO`/`BFO` | no | |
| `ltp` | number | ₹, 2 dp | yes | Last traded price. |
| `volume` | integer | contracts | yes | Cumulative day volume. |
| `oi` | integer | contracts | yes | Open interest. |
| `oi_change` | integer (signed) | contracts, absolute | yes | OI − previous trading day's closing OI. Null when baseline unknown. **Not a percentage.** |
| `net_change` | number (signed) | ₹, 2 dp, absolute | yes | LTP − previous trading day's closing LTP. Null when baseline unknown. **Not a percentage.** |
| `bid_qty` | integer | contracts | yes | Top-of-book bid quantity. |
| `bid_price` | number | ₹, 2 dp | yes | Top-of-book bid price. |
| `ask_qty` | integer | contracts | yes | Top-of-book ask quantity. |
| `ask_price` | number | ₹, 2 dp | yes | Top-of-book ask price. |
| `iv` | number | **percent**, 2 dp | yes | `18.00` means 18.00%. **Already multiplied by 100 server-side — do not multiply again.** |
| `delta` | number | dimensionless | yes | Calls: 0..1. Puts: −1..0. |
| `gamma` | number | per ₹ | yes | |
| `theta` | number (signed) | ₹ per calendar day | yes | |
| `vega` | number (signed) | ₹ per +1% IV | yes | |

Envelope fields (chain) and identity fields (leg):

| Field | Where | Type | Unit | Null? |
|---|---|---|---|---|
| `underlying` | both | string | identifier | no |
| `expiry` | both | string | ISO `YYYY-MM-DD` | no |
| `underlying_ltp` | both | number | ₹, 2 dp | yes (pre-market or no spot tick) |
| `asof` | both | integer | **UTC ms epoch** | no |
| `strike` | chain entries / leg | number | ₹, 0 dp | no |
| `side` | leg only | string | `ce`/`pe` | no |

**Null discipline**: missing values come back as JSON `null`. Never `""`, never absent, never `0` as a sentinel. A literal `0` for `oi` or `volume` means the option exists and has zero — it's data, not "missing."

---

## Migration mapping

| Old (delete) | New (use) |
|---|---|
| `GET /v1/option-chain/NIFTY?expiry=2026-05-29` | `GET /v1/option-chain/NIFTY/2026-05-29` |
| `GET /v1/greeks/NIFTY...CE` | `GET /v1/option-leg/NIFTY...CE/2026-05-29` |
| WS `option_chain.NIFTY.2026-05-29` (flat `call_*` / `put_*` shape) | WS `option_chain.NIFTY.2026-05-29` (new nested `ce`/`pe` shape — same channel name, new body) |
| WS `greeks.NFO.NIFTY...CE` | WS `option_leg.NIFTY...CE.2026-05-29` |

**Field renames** (mostly snake_case + nested):

| Old WS chain field | New WS chain field |
|---|---|
| envelope `symbol` | envelope `underlying` |
| envelope `expiryDate` | envelope `expiry` |
| envelope `underlyingValue` | envelope `underlying_ltp` |
| envelope `fetchedAt` (ms) | envelope `asof` (ms — same units) |
| envelope `rows[]` | envelope `strikes[]` |
| row `strikePrice` | strike entry `strike` |
| row `expiryDate`, `underlyingValue` | **removed** (envelope-only now) |
| `call_oi`, `put_oi` | `strikes[i].ce.oi`, `strikes[i].pe.oi` |
| `call_oiChange` | `strikes[i].ce.oi_change` |
| `call_netChange` | `strikes[i].ce.net_change` |
| `call_bidQty`, `call_bidPrice` | `strikes[i].ce.bid_qty`, `strikes[i].ce.bid_price` |
| `call_askQty`, `call_askPrice` | `strikes[i].ce.ask_qty`, `strikes[i].ce.ask_price` |
| `call_iv: 0.1978` (decimal) | `strikes[i].ce.iv: 19.78` (**percent — no client-side × 100**) |
| (no `call_delta` etc.) | `strikes[i].ce.delta`, `.gamma`, `.theta`, `.vega` |

Same pattern for the leg payload — every old `greeks.*` field is now top-level on the leg payload, plus option-side fields.

---

## Error responses

REST follows FastAPI's `{detail: "<reason>"}` shape with these codes:

| Endpoint | Status | `detail` | When |
|---|---|---|---|
| `/v1/option-chain/{u}/{expiry}` | 422 | (FastAPI default body) | `{expiry}` doesn't match `^\d{4}-\d{2}-\d{2}$`. |
| `/v1/option-chain/{u}/{expiry}` | 404 | `underlying_unknown` | `instruments:active_options` is empty. |
| `/v1/option-chain/{u}/{expiry}` | 404 | `expiry_not_subscribed` | No legs match (underlying, expiry). |
| `/v1/option-leg/{symbol}/{expiry}` | 422 | (FastAPI default body) | `{expiry}` doesn't match ISO regex. |
| `/v1/option-leg/{symbol}/{expiry}` | 422 | `expiry_mismatch` | URL expiry ≠ the expiry encoded in `instrument_meta:{symbol}`. |
| `/v1/option-leg/{symbol}/{expiry}` | 404 | `symbol_unknown` | No `instrument_meta:{symbol}` hash. |
| `/v1/option-leg/{symbol}/{expiry}` | 404 | `not_an_option` | Symbol resolves to EQ/FUT, not CE/PE. |
| `/v1/option-leg/{symbol}/{expiry}` | 404 | `no_tick_yet` | Symbol valid but no tick received yet (e.g. pre-market, first subscription). |

Auth/rate-limit error envelopes are unchanged from the existing API.

---

## Quick examples

### REST cold-load + WS deltas (chain)

```ts
// 1. Cold-load.
const res = await fetch(`/v1/option-chain/NIFTY/2026-05-29`, {
  headers: { Authorization: `Bearer ${apiKey}` }
});
const chain: ChainPayload = await res.json();
chain.strikes.forEach(s => upsertStrike(s));   // seed the in-memory model

// 2. Live deltas — same parser.
ws.send(JSON.stringify({
  id: 1, method: "subscribe",
  params: { channels: [`option_chain.NIFTY.2026-05-29`] }
}));

ws.onmessage = (m) => {
  const evt = JSON.parse(m.data);
  if (evt.c !== `option_chain.NIFTY.2026-05-29`) return;
  evt.d.strikes.forEach(s => upsertStrike(s));   // merge by strike key
  setSpot(evt.d.underlying_ltp);                  // updates even on empty strikes[]
};
```

### Per-leg fast subscribe

```ts
ws.send(JSON.stringify({
  id: 2, method: "subscribe",
  params: { channels: [`option_leg.NIFTY2026-05-2924000CE.2026-05-29`] }
}));

ws.onmessage = (m) => {
  const evt = JSON.parse(m.data);
  if (!evt.c.startsWith("option_leg.")) return;
  applyLegUpdate(evt.d);   // evt.d has the same fields as chain ce/pe + identity context
};
```

### Validating payloads against `FIELD_UNITS.ts`

```ts
import { assertSurface } from "./FIELD_UNITS";

// Chain envelope:
assertSurface("instrument_envelope", chain);
chain.strikes.forEach(s => {
  if (s.ce) assertSurface("instrument_leg", s.ce);
  if (s.pe) assertSurface("instrument_leg", s.pe);
});

// Leg payload:
assertSurface("symbol_payload", legPayload);
```

The surface names in `FIELD_UNITS.ts` (`instrument_envelope` / `instrument_leg` / `symbol_payload`) were kept — they describe the *shape*, not the channel name, so the validator still works against `option_chain.*` / `option_leg.*` payloads unchanged.

---

## Gotchas

1. **`iv` is already in percent.** A rule like `ce.iv > 18` matches strikes whose IV is above 18.00%. Do not multiply by 100 anywhere on the client.
2. **`asof` is an integer.** Wrap it in `new Date(asof)` to display. The legacy ISO string is gone.
3. **WS chain frames can have empty `strikes[]`.** This is a feature — it means the underlying ticked but no leg changed. Use it to keep the spot ticker live.
4. **Greeks lag option ticks by up to ~30 s.** Greeks values inside chain/leg payloads come from a separate 30 s recompute cycle. They'll update at ~250 ms cadence with the *most recent* computed values; the values themselves only change every ~30 s.
5. **Greeks-only consumers**: there is no longer a greeks-only channel. Subscribe to `option_leg.{symbol}.{expiry}` and ignore the option-side fields if you don't need them.
6. **Cut-over is hard.** Old endpoints/channels are gone in the same release. There's no dual-publish window.
