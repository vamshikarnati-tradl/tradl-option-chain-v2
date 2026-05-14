# Rule and Column Builder — Design Spec

This is the why and what behind the dynamic rule/column system as it ships
today. Companion to [FUNCTION_CATALOG.md](FUNCTION_CATALOG.md) (the technical
function list).

**What changed since the original spec:**
- "Filters" have been merged into Rules. There is no `FilterDefinition`, no
  `FilterBuilder`, no `FiltersPanel`. The Rule entity now does everything
  filters were intended for — cell-level tinting, free-form expressions,
  hue picker, full inline edit.
- A rule is no longer a multi-condition AND/OR tree. It is one expression
  that must evaluate to `true` or `false` at its AST root.
- The Rule Builder has two modes: **Expression** (text with syntax
  highlights) and **Visual** (Scratch-inspired nested pills). The Column
  Builder remains single-mode (no Visual yet — it's a "calculation," not a
  predicate, so the visual style would add noise).
- A new `/api/ai/refine-expression` endpoint lets users tweak an existing
  expression in natural language from inside Visual Mode.

---

## 1. Why this exists

### The problem

Traders looking at an option chain need different lenses every day. Today
they get whatever columns and highlights the developers shipped. Tomorrow
they want to compare current call OI to ten minutes ago, or highlight
strikes where put volume is in the top 5%, or compute a custom metric like
Greeks-adjusted moneyness. Hard-coding every possible view is impossible.

### The goal

Let a user describe what they want — in plain English or by clicking around
a function list — and the page instantly creates the column or rule. Fast,
safe, editable, and not dependent on an LLM being available.

### What users should feel

- "I can build the thing I'm thinking of."
- "I don't need to know how it works under the hood."
- "If the AI got it wrong, I can fix it myself."
- "I can edit anything I've made."
- "The page stays fast no matter how many rules I add."

### Non-goals

- Not a general scripting language. No loops, no variables, no side effects.
- Not a backtest engine. Rules operate on live and recent data, not
  hypotheticals.
- Not a chart builder. Output is cell-level tinting and column values, period.

---

## 2. What we're building

Three things, tightly coupled:

1. **Rule Builder** — a dedicated modal for building rules. A rule is a
   single expression that returns `true`/`false` per row. Matched rows get
   a tint on the specific cells that participate in the formula. The modal
   has an Expression mode and a Visual mode (more below).
2. **Column Builder** — a dedicated modal for building custom columns. A
   column is a single expression that returns a number per row.
3. **Function Picker** — a shared library of functions, categorized and
   discoverable, used by both builders. Functions not yet implemented are
   shown but disabled, so users know what's coming.

All three are powered by one AST (Abstract Syntax Tree), which is the
single source of truth for what a rule or column *is*.

### Two builders, same engine

| | Rule Builder | Column Builder |
|---|---|---|
| Shape | One `Expression` (must return boolean) | One `Expression` (returns a number) |
| Output | Boolean per row → cell-level tint + hover proof | Number per row → new column with formatted values |
| Modes | Expression + Visual + LLM refine | Expression only |
| Slider | Click any literal in either mode to bind | (not exposed on columns) |
| Result | Tinted cells whose fields the evaluator actually consulted | New column rendered alongside Call/Put fields |
| User expectation | "Show me where..." | "Calculate..." |

Combination logic (`AND`/`OR`/`NOT`) is expressed inside the expression
itself using `&&` / `||` / `!`. So the rule `call_volume > 50000 || put_volume > 50000` does what the old multi-condition "OR" rule used to do, in one line.

---

## 3. Format — AST is the source of truth

Everything we build round-trips through the same AST. This is the
architectural commitment.

```
plain English ──LLM──> expression string ──parser──> AST
                                                      │
                          ┌───────────────────────────┼─────────────────┐
                          │                           │                 │
                          ▼                           ▼                 ▼
                  pretty-print                    evaluate          visual view
                  (back to text)                  (compute)         (nested pills)
                          │                           │                 │
                          │                           ▼                 │
                          │                  number / boolean           │
                          └─── round-trip ────────────────────────────► │
                                                                        │
                                          NL refine ──> AST ────────────┘
```

This means:

- A rule or column saved by the LLM can be opened in either mode.
- A rule built by hand can be exported as a text expression.
- A rule edited as raw text reflows back into the Visual Mode pills.
- The same AST is what the compute engine actually runs.

No path is "second class." All edits go through the AST.

### Rule format

A Rule is stored as:

```ts
interface RuleDefinition {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Single expression whose AST root must evaluate to boolean. */
  expression: string;
  /** HSL hue 0..360 for the tint color. */
  hue: number;
  slider?: RuleSlider;
}

interface RuleSlider {
  /** Character position in `expression` of the bound literal. For a
   *  unary-minus literal (e.g. `-5000`), this points at the `-`, and
   *  the slider span covers the whole `-N` substring. */
  literalOffset: number;
  min: number;
  max: number;
  step: number;
  label?: string;
}
```

The expression is the canonical representation. `affectedFields` (which
cells light up on match) is **not** stored — it's computed at evaluation
time from the actual field reads via `evaluateWithTrace`. That trace
respects `&&`/`||` short-circuit and ternary branch selection — an `OR`
rule never tints cells from the unmatched branch.

### Column format

A custom Column is stored as:

```ts
interface CustomColumnDefinition {
  id: string;
  name: string;
  expression: string;
  format: { type: 'number' | 'percentage' | 'currency'; decimals: number };
  side: 'call' | 'put' | 'general';
}
```

### Storage

Both shapes persist to `localStorage` keys `tradl.rules.v1` and
`tradl.columns.v1`. Expressions are stored as text — the parser is the
canonical re-hydrator. The legacy multi-condition rule shape is migrated
in-place by `migrateRule()` in `core/persistence.ts`.

---

## 4. The two builders in detail

### Rule Builder layout

960px wide modal. Two-column body: editor on the left, function library
sticky on the right.

```
┌────────────────────────────────────────────────────────────────────┐
│ Edit rule                                                  [×]      │
├────────────────────────────────────────────────────────────────────┤
│ [Name input]                            [hue palette swatches]      │
│                                                                     │
│ [Expression] [Visual]              [one-line ↔ multi-line]          │
│                                                                     │
│ ┌──────────────────────────────────┐  ┌──────────────────────────┐ │
│ │ <ExpressionEditor/> or           │  │ Library                  │ │
│ │ <ExpressionView/> + LLM refine   │  │ (sticky right rail)      │ │
│ │                                  │  │                          │ │
│ │ ✓ parsed · uses call_oi, put_oi  │  │ ▾ Data                   │ │
│ │ ⓘ click any number → slider      │  │   call_oi …              │ │
│ │                                  │  │ ▾ Math                   │ │
│ │ Slider: [─────●─────]            │  │ ▾ Logic                  │ │
│ │                                  │  │ ▾ Other strikes          │ │
│ │ Preview (5 strikes):             │  │ ▸ Recent history (P2)    │ │
│ │   strike  underlying  match      │  │ ▸ Past days (P3)         │ │
│ │   24000   24050       ✓          │  │                          │ │
│ │   ...                            │  │                          │ │
│ └──────────────────────────────────┘  └──────────────────────────┘ │
│                                                                     │
│                              [Cancel] [Save changes]                │
└────────────────────────────────────────────────────────────────────┘
```

Mode + pretty-print preference is sticky across opens (persisted via
`useRuleBuilderPrefs`).

### Expression Mode

Textarea + transparent overlay. The textarea owns the cursor; the overlay
renders the same text with per-token coloring.

- **Token coloring by category.** Fields colored by side (call / put /
  market). Functions colored by their catalog category (math / logic /
  cross-strike / recent history / past days). Numbers, durations, strings,
  operators all distinct.
- **Rainbow brackets.** `(` and `)` cycle through three colors by nesting
  depth, so users can see scope at a glance.
- **Click-a-literal slider.** Every numeric literal is a clickable button
  in the overlay. Click → binds the slider to that literal. Drag the
  slider → rewrites the source string at the literal's exact char range.
  Re-parse keeps everything in sync. Click the same literal twice → unbinds.
- **Inline parse errors.** Bad characters get a soft red highlight where
  the parser failed. The error message renders below.
- **One-line / multi-line toggle.** Multi-line breaks every function call
  onto separate indented lines with closing parens at the parent indent;
  top-level `||` / `&&` chains break onto separate rows. One-line uses
  `formatExpr` for a compact representation.

### Visual Mode

The AST rendered as nested depth-shaded pills. Read-only structurally; the
LLM refine input below is the only way to mutate the expression from here.

- **Function calls** become rounded labeled boxes. The label is the
  function's natural-language form: `TOP 3 OF`, `ABSOLUTE VALUE OF`,
  `MAX OF`, `AVERAGE ACROSS STRIKES`, etc. Inner pills sit literally
  inside outer pills, with progressively lighter backgrounds by depth.
- **Special-case `topN(x, num)`** hoists the count into the label as
  `TOP {n} OF`, and the box renders only the first arg as a child.
  Same for `bottomN`.
- **Logical operators** (`&&` / `||` / `!`) render as amber `AND` / `OR` /
  `NOT` word pills. At the top level, each operand of an `||` / `&&`
  chain stacks on its own row prefixed by the pill — natural reading.
- **Comparisons** (`> < >= <= == !=`) render as violet pills with the
  glyphs `> < ≥ ≤ = ≠`.
- **Arithmetic** (`+ - * / %`) renders inline as muted symbols
  (`+ − × ÷ %`), no pill background.
- **Numbers** are green pills with thousands separators (`80,000` not
  `80000`). Click to bind the slider. Active literal gets an accent border.
- **Unary-minus + num** fuses into one NumPill (`-5000` is one pill, not
  `−` then `5000`).
- **Variables** are mono identifiers in side-tinted colors (call side =
  one color, put side = another, market = neutral).
- **Durations** (`5m`, `1d`) and **strings** (`'AVG'`) get their own
  neutral pills.
- **Constants** (`PI`, `E`) render as small purple pills.
- **Argument separators** are a muted middle-dot `·` rather than `,`.

### LLM refine (Visual Mode only)

Below the visual render, a single-line input + Apply button:

```
✦ REFINE WITH AI
[ e.g. show the inverse, or add a put-side check ]  [Apply]
```

Submits `{ currentExpression, instruction }` to `/api/ai/refine-expression`.
Server validates the result (parse + boolean root + sample dry-run) before
returning. One self-repair retry runs if the first draft fails. On success,
the new expression replaces the current one and Visual Mode re-renders.

### Column Builder layout

Same expression editor + picker, but the modal is narrower (620px) and
there's no mode toggle, no Visual Mode, no LLM refine input. Instead:
format radios (number / percentage / currency), decimals stepper, side
radios (general / call / put), and a 5-row sample preview table.

---

## 5. Function categories (the seven)

This is the top-level grouping in the picker. Categories ordered by how
often users need them.

### 1. Data
**Hover description (kid-simple):**
> All the numbers we know about the market right now. Like a scoreboard —
> each strike price has its own row of numbers.

Sub-groups:
- **Call side** — values from the call leg (call_oi, call_iv, call_ltp, …)
- **Put side** — values from the put leg (put_oi, put_iv, put_ltp, …)
- **Market** — underlying value, futures price, spot index (when available)
- **Your columns** — every custom column the user has built so far
- **Constants** — π, e, raw numbers

### 2. Math
**Hover description:**
> Doing arithmetic — add, subtract, find the biggest, find the average.
> Like a calculator.

Sub-groups: Basic (`+ - × ÷ %`), Single number (abs/round/sqrt/…),
Many numbers (sum/avg/min/max/median/stddev/…), Adjustment (clamp, lerp).

### 3. Logic
**Hover description:**
> Asking yes-or-no questions and combining them. Like saying
> "this AND that, but NOT the other thing."

Sub-groups: Conditional (ifelse, ternary), Combine (and/or/not),
Count (any, all, count).

### 4. Other strikes
**Hover description:**
> Compare this strike to the rows above and below. Like asking "is my
> strike the highest?" or "what's happening at the next strike up?"

Sub-groups: Pick one (atStrike, atOffset, atm), Aggregate over all
(sumStrikes, avgStrikes, …), Ranking (rank, pctile, topN, bottomN).

### 5. Recent history
**Hover description:**
> Look back a few seconds or minutes — what was this number then?

Sub-groups: Point in past, Over a window, Patterns. Phase 2 — visible but
disabled in the picker.

### 6. Past days
**Hover description:**
> Look back to yesterday, last week, or further. What was this number on
> that day?

Sub-groups: Specific day, Aggregate over days, Range of days, Compare.
Phase 3 — visible but disabled.

### 7. Comparisons

The verbs of a rule (`> < >= <= == !=`). Not picked from the function
list — they live inside expressions and render as violet pills in Visual
Mode. Filter Builder's old comparator slot is gone.

---

## 6. Function picker UX

### Layout

The picker has two render modes:

1. **Popover** — used by Column Builder (and any future caller). Anchored
   to a "ƒ Insert" button beside the expression input. Absolutely
   positioned, has a shadow, closes on outside click.
2. **Embedded** — used by Rule Builder. Renders as a regular flex child
   inside the modal's right column. No popover wrapper, no close button —
   always visible, never overlaps content.

The `embedded` boolean prop on `FunctionPicker` switches between them.

### Search

One typed word → highlights matching functions, fields, and custom
columns across all categories. Disabled (Phase 2 / Phase 3) functions
still appear in results so users learn what's coming.

### Hover card

Triggered by hovering any function item:

```
┌───────────────────────────────────────────────────────────┐
│  Moving Average  ·  windowAvg                             │
│  Average over the last N seconds/minutes.                 │
│  Arguments:                                               │
│    field    · fieldRef                                    │
│    period   · duration (5s, 10s, 15s, 30s, 1m, 2m, 5m)    │
│  Example:                                                 │
│    windowAvg(call_oi, 1m)                                 │
│      → average call open interest over the last minute    │
│  Returns: number                                          │
│  Status:  ⚠ Coming soon (Phase 2)                         │
└───────────────────────────────────────────────────────────┘
```

### Disabled state

- **Disabled categories** (Recent history, Past days) collapse with a
  "Phase 2" / "Phase 3" badge in the header. Clicking expands them so
  users can browse what's coming.
- **Disabled functions** inside enabled categories: text greyed, "soon"
  badge, click is a no-op.

The point: users learn the vocabulary even before the engine catches up.

---

## 7. Editability

Every saved rule and column is editable. Pencil icon on each card opens
the same builder, pre-filled. Edit → save → re-runs through the engine.

The flow:

```
User clicks "edit" on saved rule
   ↓
Builder opens with name + expression + hue + slider pre-filled
   ↓
User changes anything (text, mode, comparator, picker insert, slider drag)
   ↓
On save: re-parse → re-validate boolean root → drop slider if its offset
no longer hits a number → persist
```

### Round-trip guarantees

| Path | Guarantee |
|---|---|
| Text → AST → text (pretty-print) | Identical (up to whitespace) |
| AST → Visual → AST | Identical (Visual is a renderer, not an editor) |
| Text → AST → Visual → LLM-refine → AST → text | Same shape, new content |
| Migration: legacy multi-condition → single expression | Predefined IDs reseed; user rules collapse via `condition.lhs op rhs` joined by `&&`/`||` |

If any of these break, that's a bug.

### Deletion — guarded, never silent

Custom columns are referenceable from any expression slot (a rule, another
column, even inside a cross-strike fold like `minStrikes(maxPainLevel)`).
Deleting a column with dependents would silently break those expressions
on next parse, so the panel intercepts the click:

```
┌───────────────────────────────────────────────────────────┐
│ Delete column "maxPainLevel"?                        [×]   │
│                                                            │
│ This will also delete 2 rules and 1 column that use it:    │
│   • Rule: "MAX PAIN POINT"                                 │
│   • Rule: "Max Pain Highlight"                             │
│   • Column: "scaledMaxPain"                                │
│                                                            │
│ This can't be undone.                                      │
│                                                            │
│              [ Cancel ]  [ Delete column + 3 dependents ]  │
└───────────────────────────────────────────────────────────┘
```

Implementation: `ColumnDeleteModal` (opened by `ColumnsPanel`) calls
`findDependents(id, rules, columns)` in `core/column-deps.ts`, which
parses every rule and column expression and walks for `columnRef.id ===
target`. If both lists come back empty, the modal collapses to a plain
"Delete column?" confirm.

The destructive action is **block + offer cascade**, not silent-break and
not delete-only. Cancel changes nothing; the cascade button removes the
column plus every dependent atomically (one `onChange` call from the
parent panel). No footgun where the user thinks they've deleted one thing
and a dozen rules start throwing parse errors next reload.

Rule deletion has no equivalent guard — rules aren't referenceable, so
removing one can't break anything else.

---

## 8. Phase status

| Status | What it means | UI treatment |
|---|---|---|
| Live | Works today | Fully enabled |
| Phase 1 | Math + cross-strike + duration parsing | All Phase 1 functions are Live now |
| Phase 2 | Needs intraday history store | Disabled in picker; parser accepts, evaluator throws friendly error |
| Phase 3 | Needs backend history service | Disabled in picker; parser accepts, evaluator throws friendly error |

### What counts as "ready" per phase

- **Phase 1 ready** ✓ — parser accepts all P1 functions; evaluator
  computes them; pretty-printer round-trips them; catalog has correct
  status; LLM prompts updated.
- **Phase 2 ready** — HistoryStore implemented; ring buffers track only
  fields referenced by active rules/columns; all P2 functions evaluate
  correctly.
- **Phase 3 ready** — backend `/api/history/:symbol` exists; client
  fetches and caches per session; all P3 functions evaluate correctly.

---

## 9. File structure (as shipped)

```
packages/shared/src/
  fields.ts                  — NUMERIC_FIELDS + OptionChainRow shape
  expression-parser.ts       — tokenizer + parser + AST + char ranges + returnsBoolean
  expression-evaluator.ts    — evaluate + evaluateWithTrace + formatExpr + formatExprMultiline
  function-catalog.ts        — FunctionSpec records (master list)
  index.ts                   — public surface

packages/client/src/core/
  types.ts                   — RuleDefinition, RuleSlider, etc.
  storage-keys.ts            — localStorage key namespace
  persistence.ts             — load/save rules + columns + legacy migrator
  predefined.ts              — 10 ship-with rules in new single-expression shape
  rule-engine.ts             — compileRule + evaluateCompiledRule (trace-based)
  compute-engine.ts          — orchestrator (rules + columns)
  compute-bridge.ts          — main-thread ↔ worker typed API
  result-index.ts            — RuleHighlight, AppliedRule, cell tint helpers
  palette.ts                 — PALETTE_HUES, ruleHsl, ruleBg

packages/client/src/workers/
  compute.worker.ts          — Web Worker entry, owns ComputeEngine

packages/client/src/components/
  FunctionPicker.tsx         — shared (with `embedded` prop)
  ColumnBuilder.tsx          — column modal
  ColumnsPanel.tsx           — columns sidebar
  RulesPanel.tsx             — rules sidebar (uses RuleBuilder for new/edit)
  HoverTooltip.tsx           — cell hover proof (uses ExpressionView)
  OptionChainTable.tsx       — main table (per-cell tinting)
  ExpressionField.tsx        — legacy text input + picker popover (Column Builder still uses)
  rule-builder/
    RuleBuilder.tsx          — main modal with mode toggle
    ExpressionEditor.tsx     — textarea + transparent overlay, token-colored
    ExpressionView.tsx       — Visual Mode: depth-shaded nested pills
    SliderBinder.tsx         — click-a-literal slider that rewrites source
    RefineWithAI.tsx         — natural-language LLM refine input

packages/server/src/
  ai-parse.ts                — /api/ai/parse (legacy multi-condition output, client adapts)
  ai-refine-expression.ts    — /api/ai/refine-expression (new)
  ai-validator.ts            — parse + field allowlist + boolean root + dry-run
  prompts/
    parse.ts, parse-schema.ts
    refine.ts                — new
  snapshot-store.ts          — ATM sample row cache for dry-runs
```

### Function metadata shape

Every function has one record in `function-catalog.ts`:

```ts
interface FunctionSpec {
  technicalName: string;            // 'windowAvg'
  friendlyName: string;             // 'Moving Average'
  category: Category;
  subgroup: string;
  kidDescription: string;
  args: ArgSpec[];
  rest?: { kind: ArgKind; description?: string; minCount: number };
  returns: 'number' | 'boolean' | 'integer' | 'percent' | 'rate';
  example: string;
  exampleMeaning: string;
  status: 'live' | 'phase1' | 'phase2' | 'phase3';
  isSnapshotAware: boolean;
  isTimeAware: boolean;
  isHistorical: boolean;
}
```

Single source of truth for: picker UI, LLM prompts, the parser's arity +
arg-type checker, the evaluator's dispatch, the grey-out logic, the
boolean-root checker (via `returns: 'boolean'`).

---

## 10. Compute pipeline (worker side)

The compute engine runs in a Web Worker. Main thread posts data tick →
worker recomputes → posts results back. Cache strategy:

1. Per-row "changed fields" diff against the previous tick.
2. Globally-changed-fields set is the union across rows.
3. **Rule cache** — skip re-eval if no declared dep changed AND the rule
   isn't time-aware. Otherwise call `evaluateCompiledRule` which uses
   `evaluateWithTrace` per row, capturing the cells actually consulted
   into `affectedFields` (this is the cell-tint driver — see §3).
4. **Column cache** — per-cell memo. Reuse if the row's changed fields
   don't intersect the column's deps.

Time-aware rules (Phase 2) force a re-evaluate every tick. Historical
rules (Phase 3) parse fine but throw at evaluation until the backend
service exists.

### Mount ordering — columns ship before rules

Rules can reference saved columns by name (`maxPainLevel == minStrikes(maxPainLevel)`).
Resolution happens at compile time: `parseExpressionLoose` emits an
`unresolvedIdent` for any non-field identifier, then `resolveColumnRefs`
rewrites it into a `columnRef` node by looking up the engine's columns
map. If the columns map is empty when the rule compiles, every column
identifier surfaces as "Unknown identifier" and the rule is silently
disabled.

To prevent that on mount, `useComputeEngine` posts to the worker in a
fixed order:

```
useEffect(() => bridge.setColumns(columns), [columns]);   // first
useEffect(() => bridge.setRules(rules),     [rules, columns]);  // second
```

Two specifics worth keeping:

- **Columns first** — `setColumns` runs in its own effect that depends
  only on `columns`. The rule effect declares both `rules` and `columns`
  as deps, so a column rename re-fires rule compilation even when the
  `rules` array reference didn't change. This is what keeps a rule like
  `painLevel > 0` valid after the user renames `maxPainLevel → painLevel`.
- **Both compile pipelines need the columns map.** Inside the worker,
  `ComputeEngine.setColumns` topologically sorts columns (Kahn's
  algorithm, cycle-detected) and stores both the order and a
  `columnsByName` map. `compileRule` and the column compiler both consume
  that map. The first pass of `computeAll` evaluates columns in topo
  order and builds the `columnValues` context; the second pass evaluates
  rules against that context. Without the mount order, the first tick
  computes columns correctly but rules fail to resolve until a later
  re-render kicks the rule effect.

---

## 11. Convention notes

- **Friendly name** — Title Case, used in UI labels.
- **Technical name** — camelCase, used in expressions and the catalog.
- **Category** — seven values: Data, Math, Logic, Other strikes, Recent
  history, Past days, Comparisons.
- **Status badge** — `Live`, `Phase 1`, `Phase 2`, `Phase 3`.
- **Window literals** — lower-case alphanumeric: `5s`, `1m`, `1d`.
- **Field references** — lower_snake_case: `call_oi`, `put_iv`.
- **Boolean root requirement** for rules: the AST root must be a
  comparison binary, a logical binary (`&&` / `||`), `!`, a catalog
  function whose `returns === 'boolean'`, or a ternary whose both branches
  return boolean. Enforced statically by `returnsBoolean()`.

If this document contradicts a code-level convention, treat the code
(especially the function catalog and AST type definitions) as
authoritative.

---

## 12. Deferred — not shipped yet

- **Drag-and-drop from FunctionPicker.** Click-to-insert covers the
  common case; drag is a power-user enhancement.
- **Tree mode** as a third editor mode (deeper than Visual Mode's flat
  pill rendering).
- **Multi-rule batch operations** (enable all, bulk export).
- **Phase 2 history wiring** (the HistoryStore + intraday function bodies).
- **Phase 3 backend history service.**
- **Curated 12-color hue palette vs free hue picker.** Currently using
  the curated PALETTE_HUES (12 hues). Free picker is not exposed.
- **Context-filtered picker** — when filling a typed argument slot, the
  picker doesn't yet narrow to compatible functions. Today it shows
  everything; the parser's arg-kind check catches mismatches.
