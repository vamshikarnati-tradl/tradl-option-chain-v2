# Function Catalog

Reference for every function the AST will support across stateless and stateful
filters and custom columns. The AST is the single source of truth: an LLM or a
human form-builder both produce the same AST, and either can edit any saved
filter or column.

## Status legend

- **Live** — already implemented in the current parser/evaluator.
- **Phase 1** — add now: pure parser + evaluator changes, no storage.
- **Phase 2** — needs the intraday `HistoryStore` (client ring buffers).
- **Phase 3** — needs a backend history service. Parse, validate, error nicely
  until the service exists.

---

## 1. Stateless arithmetic (multi-input)

Operate on numbers in the current row.

| Function | Args | Returns | Status |
|---|---|---|---|
| `abs(x)` | 1 number | absolute value | Live |
| `round(x)` | 1 number | rounded to integer | Live |
| `floor(x)` | 1 number | floor | Live |
| `ceil(x)` | 1 number | ceiling | Live |
| `sqrt(x)` | 1 number | square root | Live |
| `pow(x, y)` | 2 numbers | x^y | Live |
| `log(x)` | 1 number | natural log | Live |
| `exp(x)` | 1 number | e^x | Live |
| `min(a, b, ...)` | variadic | minimum | Live |
| `max(a, b, ...)` | variadic | maximum | Live |
| `sum(a, b, ...)` | variadic | sum | Phase 1 |
| `avg(a, b, ...)` | variadic | arithmetic mean | Phase 1 |
| `median(a, b, ...)` | variadic | median | Phase 1 |
| `stddev(a, b, ...)` | variadic | population std deviation | Phase 1 |
| `variance(a, b, ...)` | variadic | variance | Phase 1 |
| `product(a, b, ...)` | variadic | product | Phase 1 |
| `range(a, b, ...)` | variadic | max - min | Phase 1 |
| `clamp(x, lo, hi)` | 3 numbers | bound to [lo, hi] | Phase 1 |
| `lerp(a, b, t)` | 3 numbers | linear interpolation | Phase 1 |
| `sign(x)` | 1 number | -1, 0, or 1 | Phase 1 |
| `any(a, b, ...)` | variadic booleans | OR-fold | Phase 1 |
| `all(a, b, ...)` | variadic booleans | AND-fold | Phase 1 |
| `count(a, b, ...)` | variadic booleans | how many are true | Phase 1 |
| `ifelse(cond, a, b)` | bool, num, num | conditional (alias of ternary) | Phase 1 |

---

## 2. Stateless cross-strike (snapshot-wide)

Operate across other strikes in the current snapshot. Evaluator must receive
the full snapshot, not just the current row.

| Function | Args | Returns | Meaning |
|---|---|---|---|
| `atStrike(field, strike)` | field, number | number | value at exact strike |
| `atOffset(field, n)` | field, integer | number | value at `current_strike + n` slots |
| `atm(field)` | field | number | value at ATM strike |
| `sumStrikes(field)` | field | number | sum across all strikes |
| `avgStrikes(field)` | field | number | mean across strikes |
| `medianStrikes(field)` | field | number | median |
| `minStrikes(field)` | field | number | min |
| `maxStrikes(field)` | field | number | max |
| `stddevStrikes(field)` | field | number | std dev |
| `rank(field)` | field | integer | rank of current row's value |
| `pctile(field)` | field | 0..100 | percentile of current row |
| `topN(field, n)` | field, integer | boolean | is current strike in top N? |
| `bottomN(field, n)` | field, integer | boolean | is current strike in bottom N? |

All Phase 1.

---

## 3. Stateful intraday (client storage)

Sampled every tick by the client's `HistoryStore`. Window literals limited to:

```
1tick · 5s · 10s · 15s · 30s · 1m · 2m · 5m
```

Anything longer routes through Section 4.

| Function | Args | Returns | Meaning |
|---|---|---|---|
| `prev(field, period)` | field, duration | number | value at `now - period` |
| `change(field, period)` | field, duration | number | current minus past |
| `pchange(field, period)` | field, duration | percent | percent change |
| `windowAvg(field, period)` | field, duration | number | mean over window |
| `windowSum(field, period)` | field, duration | number | sum |
| `windowMin(field, period)` | field, duration | number | min |
| `windowMax(field, period)` | field, duration | number | max |
| `windowMedian(field, period)` | field, duration | number | median |
| `windowStddev(field, period)` | field, duration | number | std dev |
| `windowFirst(field, period)` | field, duration | number | first sample in window |
| `windowLast(field, period)` | field, duration | number | most recent sample |
| `windowRange(field, period)` | field, duration | number | max - min |
| `windowCount(field, period)` | field, duration | integer | sample count |
| `crossedAbove(field, threshold, period)` | field, num, duration | boolean | crossed threshold up |
| `crossedBelow(field, threshold, period)` | field, num, duration | boolean | crossed threshold down |
| `trendUp(field, period)` | field, duration | boolean | monotonically rising |
| `trendDown(field, period)` | field, duration | boolean | monotonically falling |
| `velocity(field, period)` | field, duration | rate | average change per second |

All Phase 2.

---

## 4. Stateful interday (backend service, deferred)

Lookback longer than 5 minutes. The AST parses these now; the evaluator returns
`null` and an error message until the backend service is built. Window
literals:

```
10m · 15m · 30m · 1h · 2h · 5h · 1d · 2d · 5d · 10d · 15d
```

Aggregation types accepted in `historical()`:

```
EOD · AVG · MEDIAN · MAX · MIN · STDDEV · FIRST · LAST
```

| Function | Args | Returns | Meaning |
|---|---|---|---|
| `historical(field, range, agg)` | field, duration, enum | number | unified gateway |
| `eod(field, daysAgo)` | field, integer | number | close N days back |
| `sessionOpen(field)` | field | number | today's open |
| `sessionClose(field, daysAgo)` | field, integer | number | close N days back |
| `sessionHigh(field, daysAgo)` | field, integer | number | high N days back |
| `sessionLow(field, daysAgo)` | field, integer | number | low N days back |
| `yesterdayAvg(field)` | field | number | yesterday's intraday average |
| `daysAgoAvg(field, n)` | field, integer | number | average N days back |
| `rangeMin(field, fromDays, toDays)` | field, integer, integer | number | min across range |
| `rangeMax(field, fromDays, toDays)` | field, integer, integer | number | max across range |
| `nDayHigh(field, n)` | field, integer | number | high over last N days |
| `nDayLow(field, n)` | field, integer | number | low over last N days |
| `nDayAvg(field, n)` | field, integer | number | average over last N days |
| `compareToYesterday(field)` | field | percent | pchange vs yesterday close |

All Phase 3.

### Deferred backend contract

When implemented, the client batches all interday function calls into one
request per symbol+session, cached locally.

```
POST /api/history/:symbol
{
  strikes: [24000, 24050, ...],
  requests: [
    { field: 'call_ltp', range: '1d', agg: 'EOD' },
    { field: 'put_oi',   range: '5d', agg: 'AVG' },
    ...
  ]
}

→ { 'call_ltp@24000@1d@EOD': 245.5, ... }
```

Cache invalidation: per trading session. Refetched on session rollover.

---

## 5. Duration literal syntax

The parser recognizes duration tokens as a new primitive. Allowlist:

| Tier | Allowed values | Routed to |
|---|---|---|
| Tick | `1tick` | client history |
| Second | `5s · 10s · 15s · 30s` | client history |
| Minute (short) | `1m · 2m · 5m` | client history |
| Minute (long) | `10m · 15m · 30m` | backend |
| Hour | `1h · 2h · 5h` | backend |
| Day | `1d · 2d · 5d · 10d · 15d` | backend |

Invalid windows (`7m`, `42s`, `3d`) fail at parse time with a clear error
listing allowed values.

AST node form:
```ts
{ kind: 'duration', value: 300, unit: 's' }   // 5 minutes
```

---

## 6. New AST node types

Current ([packages/client/src/core/expression-parser.ts:5-12](packages/client/src/core/expression-parser.ts#L5-L12)):

```
num · const · field · unary · binary · ternary · call
```

Add for the catalog above:

| Node | When used |
|---|---|
| `duration` | `5m`, `30s`, `1d` window literals |
| `fieldLit` | A field name passed as an argument (`avg(call_oi, 1m)` — `call_oi` is a *reference*, not a value read from the current row) |
| `stringEnum` | The `'EOD' \| 'AVG' \| 'MAX' \| ...` argument to `historical()` |

The `fieldLit` distinction matters: stateful functions look up history by
(strike, field), so the field name must arrive as a token, not as the
already-evaluated number from the current row.

---

## 7. Dependency extraction extension

`extractDependencies(ast)` currently returns `NumericField[]`. Replace with:

```ts
interface AstDependencies {
  fields: NumericField[];                                       // simple row reads
  intraday: { field: NumericField; maxWindow: Duration }[];    // for HistoryStore
  historical: {                                                 // for backend batching
    field: NumericField;
    range: Duration;
    agg: HistoricalAgg;
  }[];
  needsSnapshot: boolean;                                       // cross-strike funcs
  isTimeAware: boolean;                                         // forces recompute every tick
}
```

Used by:
- `HistoryStore` — only ring-buffer fields appearing in some `intraday` dep.
- Backend fetcher — batch all `historical` deps per symbol.
- `ComputeEngine` — skip rule re-eval if no field changed AND not time-aware.

---

## 8. HistoryStore (intraday storage)

| Concern | Choice |
|---|---|
| Shape | `Map<strike, Map<field, RingBuffer<{ t: number; v: number }>>>` |
| Sample rate | Every tick (already decimated by server poll cadence) |
| Cap | Last `max(maxWindow across all active deps) + 30s` per series |
| Persistence | localStorage; throttled write every 30s + on tab close |
| Lifecycle | Buffer starts when a filter/column references the field; drops when no consumer remains |

Memory budget at default workload: ~4 MB worst case
(41 strikes × 22 fields × 1000 samples × 16 bytes), realistic ~500 KB once
deduped to actually-referenced fields.

---

## 9. Function metadata catalog (for the manual builder)

Every function above has a static metadata record consumed by the "+ filter"
popup:

```ts
interface FunctionSpec {
  name: string;
  category: 'arithmetic' | 'crossStrike' | 'intraday' | 'interday';
  description: string;
  args: ArgSpec[];
  returns: 'number' | 'boolean' | 'integer' | 'percent' | 'rate';
  example: string;
  status: 'live' | 'phase1' | 'phase2' | 'phase3';
}

type ArgSpec =
  | { name: string; type: 'number' }
  | { name: string; type: 'integer' }
  | { name: string; type: 'fieldRef' }
  | { name: string; type: 'duration'; allowed: string[] }
  | { name: string; type: 'enum'; allowed: string[] }
  | { name: string; type: 'expression' }                  // nested sub-tree
  | { name: string; type: 'variadic'; element: ArgSpec };
```

The form builder reads this catalog → renders a typed form for any function.
The same form drives "create new" and "edit existing" flows.

---

## 10. Round-trip editability

For any saved filter or column to be editable, three pieces must exist:

| Piece | Status | Effort |
|---|---|---|
| Parser: expression string → AST | Live | — |
| Pretty-printer: AST → expression string | Missing | small (~80 LOC) |
| Form-builder: AST ↔ form state, catalog-driven | Missing | larger (a week) |

With these in place, opening any filter (LLM-generated or hand-built) renders
the same form, with a "raw expression" toggle. The two views are bidirectional.

---

## 11. Build order

1. **Phase 1 — stateless extensions** (~2 days)
   - Add Section 1 functions to evaluator.
   - Wire snapshot context into `evaluate()` so Section 2 functions work.
   - Add Section 2 functions.
   - Update LLM few-shot examples with the new vocabulary.

2. **Phase 1.5 — duration literals + Phase 3 stubs** (~1 day)
   - Extend tokenizer with duration literals.
   - Add `duration`, `fieldLit`, `stringEnum` AST nodes.
   - Section 4 functions parse + validate but error at evaluation.

3. **Phase 2 — intraday state** (~1 week)
   - Build `HistoryStore` with ring buffers + localStorage persistence.
   - Implement Section 3 functions.
   - Extend dependency extraction.
   - Filter entity gains `isTimeAware` flag (always-recompute hot path).

4. **Manual builder + pretty-printer** (~1 week)
   - Function catalog metadata file.
   - Pretty-printer.
   - Form ↔ AST adapter.
   - "+ filter" popup UI.

5. **Phase 3 — interday** (after backend service exists)
   - Wire `/api/history/:symbol` client and server.
   - Implement Section 4 functions properly.
   - Caching strategy: per-session, invalidated on rollover.

---

## 12. Open questions

- Should `field` literals in stateful functions accept expressions, or only
  raw field names? (`windowAvg(call_oi + put_oi, 1m)` vs `windowAvg(call_oi, 1m)`)
  Recommendation: raw fields only at first — expression args would require
  buffering computed values, much heavier.
- Cross-strike + stateful combinations
  (`avgStrikes(windowAvg(call_oi, 1m))`) — allowed? Recommendation: yes, the
  evaluator already composes naturally; we just need to be careful about
  recompute cost.
- Should backend history be per-strike or per-symbol? Per-strike is precise
  but heavier; per-symbol is cheaper but limits what the user can ask.
  Recommendation: per-strike, with server-side caching.
