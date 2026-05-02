# tradl / option-chain

Live NSE option chain with a client-side rule engine, custom column builder, and an AI command palette that turns plain English into engine-ready rules and columns.

## Run locally

```bash
npm install
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

The Vite dev server proxies `/api/*` and `/ws/*` to the backend. Open http://localhost:5173.

### Optional: AI command palette

Set `ANTHROPIC_API_KEY` in `.env` at the repo root to enable the natural-language palette (`/` or `Cmd+K`):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Without the key, only the palette returns 503 — the rest of the app works.

### Optional: live NSE feed

```bash
DATA_SOURCE=nse npm run dev:server
```

Defaults to a realistic mock generator (NSE's endpoint sits behind Akamai bot protection). Both sources produce identical row shapes, so the engine exercises the same code paths.

---

## What it is

Option-chain dashboards usually ship with a fixed set of derived metrics and highlight rules. If you want one the vendor didn't build (e.g. "highlight strikes where put OI dominance crosses 3× and call IV spikes above 16"), you wait, file a ticket, or export to Excel.

This project gives traders that authoring surface in the chain itself:

- **Rules** highlight strikes that match a condition. Define them in a side panel or by describing them in plain English.
- **Columns** show derived calculations alongside the raw data — built from a safe expression language over the raw fields.

Everything runs against a live WebSocket feed and re-evaluates every tick, off the main thread.

---

## Highlights

### 1. AI command palette

Press `/` (cursor-anchored) or `Cmd+K` / the Ask button (centered) and describe what you want:

```
> highlight strikes where put OI is more than 3× call OI
> add a column for straddle price
> moneyness as a percentage
```

Claude Haiku 4.5 with structured outputs parses the input into a strict JSON rule or column shape that drops straight into the same engine the side panel writes to. Low-confidence parses surface as a "best guess" warning with an inline JSON editor; ambiguous prompts ("put call ratio") return option chips so the user picks the intent. Recent prompts persist locally for one-tap re-use.

### 2. Safe expression language

A custom recursive-descent parser produces a typed AST — no `eval`, no `Function()` constructor. Both the rule engine (LHS + RHS of every condition) and the custom column builder consume the same AST.

```
+ - * / %     comparison > < >= <= == !=     logical && || !     ternary ?:
abs min max round floor ceil sqrt pow log exp     constants PI E
field references: call_oi, put_iv, strikePrice, ...
```

### 3. Live rule engine with rich condition shapes

Every rule is a list of conditions composed with `AND` / `OR`. Each condition has:

- `lhs`: a single field (fast path) or a free expression
- `operator`: `gt | gte | lt | lte | eq | neq | between`
- `rhs`: a literal, another field, an expression, or a range

Plus a `scope` (`call | put | row` — controls which side of the row gets the color tint) and an HSL hue picked from a built-in palette so collisions stay readable. Eight predefined rules ship out of the box (High Call/Put OI, IV Skew, OI Buildup/Unwinding, PCR Bullish/Bearish, Volume Spike); user rules persist locally.

### 4. Custom column builder

Same expression language, separate surface. Type `(call_ltp + put_ltp)` and get a Straddle column; `abs(call_iv - put_iv)` for IV gap; `(strikePrice - underlyingValue) / underlyingValue * 100` for moneyness. The builder shows live syntax help, parses on every keystroke, and surfaces errors inline. Two presets ship by default (PCR, Straddle).

### 5. Mobile-first responsive UI

The chain is meant to be readable on a phone, not just a Bloomberg terminal:

- Bottom action bar replaces header chrome on `< md` (Ask · Rules · Columns)
- Command palette renders as a bottom sheet with slide-up animation on mobile, cursor-anchored on desktop
- Spot row stays sticky at both top and bottom of the viewport while scrolling — and the spot pill itself uses a horizontal-sticky wrapper so it stays centered in the viewport even when the table is wider than the screen
- On first load (and on symbol change) the table auto-scrolls to center the spot row
- Side panels go full-width on mobile, 380px on desktop
- 4 themes (Paper / Frost / Clean / Terminal) with semantic CSS tokens that override per theme

### 6. Persistence + schema migration

Rules, columns, theme, and layout preferences round-trip through `localStorage`. Old rule shapes (legacy `color: hex` styles) are migrated to the current `hue: number` shape on read so users don't lose data across releases.

### 7. Single-service deploy

One Railway service serves the Express API, the WebSocket endpoint, and the built React client from the same origin. No CORS dance, no second service for the frontend, WebSocket on the same hostname.

---

## Tech

- **Frontend** — React 18 + TypeScript, Vite, Tailwind 3, TanStack Query (HTTP caching + mutation lifecycle), a Web Worker for compute, `createPortal` for modals
- **Backend** — Node 20 + Express + `ws`, Anthropic SDK (`claude-haiku-4-5` via structured outputs)
- **Monorepo** — npm workspaces (`packages/server`, `packages/client`)
- **Deploy** — Railway via `railway.json`

---

## Performance

Tick-to-paint is < 50ms with the predefined rule + column set on a typical laptop. Key choices:

- **Web Worker compute.** All rule and column evaluation runs in `workers/compute.worker.ts`. The main thread only paints. Snapshots arrive over WebSocket → `ComputeBridge` posts to the worker → worker posts back result diffs.
- **Field-level dependency tracking.** Each rule and each column declares which fields it reads (extracted from its AST). On every tick, the engine diffs the new row against the prev row to compute a changed-fields set, then skips any rule/column whose dependencies didn't change.
- **Per-cell column cache.** When a column's deps for a specific strike haven't changed, the cached value is reused — no AST walk for that cell.
- **Result indexes.** Worker results (rule matches, column values) are inverted into per-strike maps once on the main thread, giving the table O(1) reads per cell render.
- **Memoized rows.** `StrikeRow` is wrapped in `React.memo`; the table re-renders only the strikes whose props identity changed.
- **CSS-only sticky behavior.** The spot row uses `position: sticky` with both `top` and `bottom` set — no IntersectionObserver, no scroll listeners.
- **TanStack Query for HTTP.** `/api/expiries/:symbol` is cached with a 30s stale time and auto-cancelled on symbol change. The AI parse mutation cancels stale in-flight requests as the user keeps typing.
- **Lazy compute bridge.** Stored in a `useRef` rather than `useMemo` so React 18 StrictMode's mount → unmount → remount doesn't terminate the worker on first paint.

Production bundle: ~270 KB JS, ~82 KB gzipped.

---

## What more can we do

- **Multi-symbol view** — split-screen comparison (e.g. NIFTY + BANKNIFTY side by side)
- **Historical sparklines per cell** — a small inline chart for OI / LTP over the last N ticks
- **Sharing** — export a rule + column set as JSON and import into another session
- **Ghost columns** - view in real time as you build a column