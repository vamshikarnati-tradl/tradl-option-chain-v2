# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root (npm workspaces fan out to both packages):

```bash
npm install
npm run dev:server    # http://localhost:4000 (Express + WS)
npm run dev:client    # http://localhost:5173 (Vite, proxies /api and /ws to :4000)
npm run build         # builds both workspaces; client emits packages/client/dist
npm run start         # node packages/server/dist/index.js — production entry
npm run typecheck     # tsc --noEmit in both workspaces
```

- `.env` lives at the repo root. `tsx watch --env-file=../../.env` in `@tradl/server` loads it.
- `ANTHROPIC_API_KEY` gates only `/api/ai/parse` (503 without it); the rest of the app runs fine.
- `DATA_SOURCE=nse npm run dev:server` switches off the mock generator. Default is `mock` because NSE's endpoint is behind Akamai.
- `POLL_INTERVAL_MS` overrides the per-symbol poll cadence (default 2s mock / 60s nse).
- No test suite exists. `npm run typecheck` is the only correctness gate.

## Architecture

### Single-service deploy
One Express process (`packages/server/src/index.ts`) serves the REST API, the WebSocket endpoint, AND the built React client from the same origin. In dev, Vite owns the static files; in prod the server detects `packages/client/dist` and serves it with an SPA fallback. Same hostname → no CORS, WebSocket on the same origin. Railway uses `railway.json` (NIXPACKS, healthcheck on `/api/health`).

### Server: per-symbol polling, fan-out over WS
The server keeps a `Map<symbol, SymbolState>` with `{ latest, subscribers, pollHandle }`. A symbol starts polling when the first client subscribes via `/ws/option-chain/:symbol`, stops when the last disconnects. New subscribers immediately receive the cached `latest` snapshot, then live ticks via `broadcast()`. Polling and broadcasting are independent of any individual client — disconnects only affect that client's subscription. `nse-fetcher.ts` and `mock-source.ts` are interchangeable behind `fetchSnapshot`/`listExpiries` — both produce identical `OptionChainSnapshot` shapes so the engine exercises one code path.

The server installs `uncaughtException`/`unhandledRejection` handlers that swallow `EPIPE`/`ECONNRESET` (peer disconnects mid-write). Without these, one failed AI parse against a vanished client crashes the whole process and takes the data WS with it. **Keep these handlers.**

### Client: Worker-isolated compute, main thread only paints
The hottest path is rule + column evaluation on every tick. It runs in `packages/client/src/workers/compute.worker.ts`, which wraps `core/compute-engine.ts`. The main thread talks to it through `core/compute-bridge.ts` (typed `ComputeBridge` class with `setRules`, `setColumns`, `updateData`, `onResult`, `onConfigErrors`).

Critical detail: `ComputeBridge` is held in a `useRef`, NOT `useMemo`. React 18 StrictMode mounts → unmounts → remounts in dev; a `useMemo` would terminate and recreate the worker on first paint. If you touch `useComputeEngine`, preserve this.

### Expression language → AST → engine
`core/expression-parser.ts` is a hand-written recursive-descent parser producing a typed `Expr` AST. Supports `+ - * / %`, comparisons, `&& || !`, ternary, builtins (`abs min max round floor ceil sqrt pow log exp`), constants `PI E`, and field references over `NUMERIC_FIELDS` (defined in `core/types.ts`). **No `eval`, no `Function()`.** Both the rule engine (`core/rule-engine.ts`) and custom columns consume the same AST through `core/expression-evaluator.ts`. `extractDependencies(ast)` walks the AST to produce the `NumericField[]` a rule/column reads — this drives all caching.

### Caching: dependency-aware, two-tier
On every tick `ComputeEngine.computeAll`:
1. Builds a per-row "changed fields" set by diffing against `prevRows`.
2. For each rule: skips re-evaluation if none of its declared deps appear in the globally-changed set (rule-level cache key in `ruleCache`).
3. For each column cell: skips re-evaluation per strike if that row's changed set doesn't intersect the column's deps (per-strike `cellCache` on the compiled column).

If you add anything that mutates rule/column behavior without changing their declared dependencies, either invalidate the cache (`setRules`/`setColumns` clear it) or make the new input part of the dependency set. Stale-cache bugs here will manifest as cells that "don't update."

### Result indexing
Worker output is a `RuleResult[]` and `ColumnResult[]`. The main thread converts these into per-strike maps once per result (`core/result-index.ts`) so `StrikeRow` reads are O(1) during render. `StrikeRow` is `React.memo`'d; preserve prop identity if you touch the table.

### Persistence + migration
`core/persistence.ts` round-trips rules, columns, and toggles through `localStorage` (keys in `core/storage-keys.ts`). Legacy `RuleStyle.color: hex` shapes are migrated to the current `hue: number` on read — do not break this migration silently when changing rule shapes.

### AI palette (server-mediated)
Client `services/aiParse.ts` POSTs free text to `/api/ai/parse`. Server `ai-parse.ts` calls Claude (`claude-haiku-4-5`) with structured outputs defined in `prompts/parse-schema.ts` and a system prompt in `prompts/parse.ts`. Response shape is `{ intent: 'rule' | 'column' | 'ambiguous', humanReadable, confidence, rule?, column?, options? }`. Low confidence → "best guess" warning + JSON editor; `ambiguous` intent → option chips. The parsed rule/column drops straight into the same `setRules`/`setColumns` setters the side panels use — there is no parallel code path.

## Conventions worth knowing

- ESM throughout. Server imports relative paths with **`.js` extensions** (e.g. `import { parseAi } from './ai-parse.js'`) — this is required for `tsc` ESM output to resolve at runtime. Already bit the repo once (commit `061cdd4`).
- `OptionChainRow` shape is defined in `core/types.ts` AND `server/src/types.ts`; both must stay aligned. `NUMERIC_FIELDS` is the source of truth for what the expression language and rule LHS/RHS accept.
- 4 themes via semantic CSS tokens (Paper/Frost/Clean/Terminal). Component code uses `bg-bg-0`, `text-pos`, `border-pill-neg-border`, etc. — never raw hex. The hue/scope on rules drives runtime tinting via HSL.
- `< md` breakpoint forces the table into compact mode regardless of the persisted toggle (Vol/IV columns overflow on mobile). The header chrome collapses into a `BottomBar` at the same breakpoint.
