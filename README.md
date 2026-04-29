# tradl-option-chain

Live option chain demo with a client-side rule engine and custom column builder.
See [PRD](./PRD.md) (or the conversation history) for the full design.

## Status — Pass A + Pass B complete

End-to-end pipeline working:

**Pass A:** backend → WebSocket → in-memory store → live React table with ATM highlighting and ITM shading.

**Pass B:** Web Worker compute engine with field-level dependency tracking and per-cell memoization. 8 predefined rules (High Call/Put OI, IV Skew, Call OI Buildup/Unwinding, PCR Bullish/Bearish, Volume Spike) and 4 predefined custom columns (PCR, IV Spread, Straddle, Moneyness). Side panel for editing rules (field/expression LHS, operator, literal/field/expression RHS, AND/OR composition, scope = call/put/row, color picker) and custom columns (free-form expression with autocomplete-friendly syntax). All persisted to `localStorage`. Compute stats (durationMs / cache reuse) shown in the footer.

## Project layout

```
packages/
  server/   Express + ws server. Polls a data source, broadcasts snapshots.
  client/   Vite + React + TS + Tailwind. WS client + table.
```

## Running

```bash
npm install
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

The Vite dev server proxies `/api/*` and `/ws/*` to the backend.

## Data source

The backend supports two sources, selected by `DATA_SOURCE` env var:

- **`mock`** (default) — generates a realistic Nifty-shaped chain (41 strikes around ATM, OI weighted by moneyness, IV smile, mean-reverting random-walk on spot, tick-to-tick LTP movement). Polls every 2s.
- **`nse`** — fetches live (delayed) data from NSE. Polls every 60s.

```bash
DATA_SOURCE=nse npm run dev:server
```

### Why mock is the default

NSE's option-chain endpoint is behind Akamai bot protection that returns `200 OK` with body `{}` for non-browser clients. Cookie warm-up via `/`, `/option-chain`, and `/api/marketStatus` succeeds, but the option-chain endpoint itself stays cached-empty (`x-cache: HIT`, `content-length: 2`). Reliably bypassing this typically requires a residential proxy or a headless browser — neither warranted for a compute-engine demo.

The mock generator produces data with the same shape and semantics as NSE, so the rule engine and expression evaluator (Pass B) will exercise identical code paths regardless of source. To work against live NSE, point the server at a residential proxy or replace `nse-fetcher.ts` with a Puppeteer/Playwright-based scraper.

## Backend API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness check |
| GET | `/api/symbols` | Supported symbols |
| GET | `/api/expiries/:symbol` | Available expiries |
| GET | `/api/option-chain/:symbol?expiry=...` | One-shot snapshot |
| WS  | `/ws/option-chain/:symbol` | Push snapshots on each poll |

Supported symbols: `NIFTY`, `BANKNIFTY`, `FINNIFTY`.

## Architecture (Pass B)

```
DataStore (main thread)
     │  rows
     ▼
ComputeBridge ───── postMessage ─────► Web Worker
     │                                       │
     │ result events                         │ ComputeEngine
     ▼                                       │   ├─ compileRule (lhs/rhs → AST)
useComputeEngine                             │   ├─ compileColumn (expr → AST)
     │ ruleResults, columnResults            │   ├─ diff prevRows vs new
     ▼                                       │   ├─ rule cache (skip if no dep changed)
indexRuleResults / indexColumnResults        │   └─ cell cache (skip per-row if no dep changed)
     │
     ▼
OptionChainTable (renders highlights + custom column cells)
```

Key files:

- `core/expression-parser.ts` — recursive-descent parser, produces a typed AST. No `eval`.
- `core/expression-evaluator.ts` — pure AST → number against an `OptionChainRow`.
- `core/rule-engine.ts` — compiles a `RuleDefinition` into a closure pair (`evalLhs`, `evalRhs`) per condition; supports `field op literal`, `field op field`, and `expr op anything`.
- `core/compute-engine.ts` — owns `prevRows`, rule cache, and per-cell column cache; tracks which fields changed each tick to short-circuit re-evaluation.
- `workers/compute.worker.ts` — Web Worker entry point; receives `UPDATE_DATA` / `SET_RULES` / `SET_COLUMNS`, posts back `COMPUTE_RESULTS` with timing + cache hits.
- `core/result-index.ts` — inverts rule/column result lists into per-strike maps for O(1) read in the table.

## What's next (Phase 3 of the PRD)

- Benchmark with 50+ active rules and 10+ custom columns to validate the < 5ms / < 50ms targets
- Virtual scrolling for the table (currently fine for Nifty's ~40 strikes, but would matter for full equity chains)
- Visual rule builder (drag-and-drop conditions, presets/templates that fork)
- Multi-symbol simultaneously
- Historical sparklines per cell
