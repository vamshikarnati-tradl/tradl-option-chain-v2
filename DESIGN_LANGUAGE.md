# Tradl Option Chain — Design Language

A portable spec of the visual system: four themes (Paper, Frost, Clean, Terminal), the semantic color tokens that drive them, typography, spacing, and the component primitives built on top. Use this as the source of truth when designing new surfaces (in Figma, Canva, or any external tool) so they read as part of the same product.

---

## 1. Design philosophy

- **Data-first.** UI chrome is quiet so numbers carry the page. No drop shadows on data, no per-row dividers in the default theme, no decorative gradients.
- **Tabular numerics everywhere.** Every price, percentage, volume, OI, and threshold uses `font-feature-settings: "tnum"` so digits align in columns.
- **Semantic tokens, not raw hex.** Components reference roles (`bg-bg-1`, `text-ink-2`, `border-line`, `text-pos`). Themes remap those roles. Never put a hex in a component.
- **One product, four moods.** Paper and Frost are light; Clean and Terminal are dark. Same layout, same spacing, same components — only tokens change. Terminal additionally swaps the table font to monospaced and uppercases its column headers.
- **Tone via hue, not chrome.** Gains/losses are color (pos/neg). Rules tint cells using HSL with a runtime-controlled hue. Don't introduce new "alert" surfaces — fold meaning into existing pos/warn/neg/accent tones.

---

## 2. The four themes

Themes are applied by toggling a single body class. "Clean" has no class — it is the dark baseline.

| Theme    | Body class      | Mood                                  | Surface tone        | Primary accent |
| -------- | --------------- | ------------------------------------- | ------------------- | -------------- |
| Paper    | `theme-paper`   | Warm, printed sheet                   | Off-white cream     | `#2563eb`      |
| Frost    | `theme-frost`   | Cool, crisp white                     | Pure white + grays  | `#1d4ed8`      |
| Clean    | _(none, default)_ | Quiet dark, minimal grid              | Near-black blue     | `#6ea8ff`      |
| Terminal | `theme-terminal`| Dense, monospaced, gridded            | Same dark as Clean  | `#6ea8ff`      |

Terminal inherits Clean's color tokens — it only changes the table chrome: monospaced font, uppercased small-caps column headers, ITM-side gradients restored, per-row borders, and a 1px ATM ring.

---

## 3. Color tokens

Tokens have semantic names. Theme overrides map the same token to a different hex.

### 3.1 Surfaces (`bg-bg-0` → `bg-bg-4`)

A 5-step surface scale, lightest-to-deepest in dark themes, darkest-to-deepest in light themes. Use:

- `bg-0` — app background (body)
- `bg-1` — primary card / header / panel
- `bg-2` — hover surface, secondary card
- `bg-3` — pressed / pill / chip neutral / sw-knob track
- `bg-4` — deepest control (sliders, off-state switch)

| Token  | Clean / Terminal | Paper      | Frost      |
| ------ | ---------------- | ---------- | ---------- |
| `bg-0` | `#0a0b0e`        | `#f6f3ed`  | `#f7f8fa`  |
| `bg-1` | `#0e1014`        | `#fbf9f5`  | `#ffffff`  |
| `bg-2` | `#14171c`        | `#efece5`  | `#f1f3f6`  |
| `bg-3` | `#1b1f26`        | `#e6e2d8`  | `#e7eaf0`  |
| `bg-4` | `#242932`        | `#d9d4c7`  | `#d6dae3`  |

### 3.2 Text (ink scale)

| Token    | Usage                                | Clean / Terminal | Paper      | Frost      |
| -------- | ------------------------------------ | ---------------- | ---------- | ---------- |
| `ink`    | Primary body text, table values      | `#e6e8eb`        | `#1c1d1f`  | `#0f1115`  |
| `ink-2`  | Secondary text, labels               | `#a8aeb8`        | `#4a4d52`  | `#44495a`  |
| `ink-3`  | Tertiary, microcopy (uppercase keys) | `#6c7480`        | `#888c92`  | `#7a8294`  |
| `ink-4`  | Disabled, faintest hint              | `#4a515b`        | `#b4b6ba`  | `#b1b7c4`  |

### 3.3 Lines / dividers

| Token     | Clean / Terminal | Paper      | Frost      |
| --------- | ---------------- | ---------- | ---------- |
| `line`    | `#1f242c`        | `#e3dfd3`  | `#e8ebf0`  |
| `line-2`  | `#2a3038`        | `#d2cdbf`  | `#d4d9e2`  |

### 3.4 Semantic tones

| Role               | Token        | Clean / Terminal | Paper      | Frost      |
| ------------------ | ------------ | ---------------- | ---------- | ---------- |
| Positive / gain    | `pos`        | `#4ade80`        | `#167d3a`  | `#16a34a`  |
| Negative / loss    | `neg`        | `#f87171`        | `#c2331a`  | `#dc2626`  |
| Accent / interactive | `accent`   | `#6ea8ff`        | `#2563eb`  | `#1d4ed8`  |
| Accent hover       | `accent-hover` | `hsl(217 100% 75%)` | `#1e40af` | `#1e3a8a`  |

### 3.5 Chips & pills (low-opacity halos)

Chips and pills use a fill (low-alpha tint) + matching border + the corresponding text color.

| Chip kind   | Surface tint            | Border tint             | Text                | Used for              |
| ----------- | ----------------------- | ----------------------- | ------------------- | --------------------- |
| `field`     | blue 20% / 8%           | blue 40% / 25%          | `text-field`        | Field-name references |
| `op`        | `bg-3`                  | `line-2`                | `ink-2`             | Operators (`>`, `+`)  |
| `value`     | amber 25% / 10%         | amber 50% / 30%         | `text-value`        | Numeric thresholds    |
| `mult`      | purple 20% / 10%        | purple 40% / 30%        | `text-multiplier`   | Multipliers (`×0.5`)  |
| `expr`      | `bg-3`                  | `line-2`                | `text-codeblock`    | Inline expressions    |

State pills (small uppercase status badges) use five tones: `neutral`, `pos`, `warn`, `neg`, `accent`. Same pattern — low-alpha fill + border + matched text color.

### 3.6 Rule tinting (cell-level)

Rules tint matching cells using a user-chosen **HSL hue** (0–360) at fixed saturation/lightness. The hue is the rule's identity; the cell uses ~10–18% lightness alpha as fill and the same hue at higher saturation for text. This is the only place hue is data, not chrome.

---

## 4. Typography

### 4.1 Font pairings

Selectable via body class. Each pairing defines a **sans (body)** and a **mono (numbers/code)**. Mono is opt-in via `.font-mono`, `.tnum`, `<code>`, `<kbd>`.

| Class             | Sans              | Mono              | Notes                              |
| ----------------- | ----------------- | ----------------- | ---------------------------------- |
| `font-plex`       | IBM Plex Sans     | IBM Plex Mono     | Neutral, technical                 |
| `font-inter`      | Inter Tight       | JetBrains Mono    | Tight tracking, modern             |
| `font-instrument` | Instrument Sans   | Geist Mono        | + Instrument Serif italic wordmark |
| `font-jet`        | JetBrains Mono    | JetBrains Mono    | All-mono terminal aesthetic        |

`brand-wordmark` is rendered in Instrument Serif italic when the Instrument pairing is active — the only place serif appears in the product.

### 4.2 Type scale

Small. The product reads like a Bloomberg terminal, not a marketing page.

| Use                          | Size       | Weight  | Tracking     | Case         |
| ---------------------------- | ---------- | ------- | ------------ | ------------ |
| Brand wordmark               | 12.5px     | 600     | -0.01em      | Sentence     |
| Page / panel title           | 13px       | 600     | normal       | Sentence     |
| Body / table value           | 12px       | 400     | normal       | Sentence     |
| Toolbar button label         | 12px (xs)  | 500     | normal       | Sentence     |
| Microcopy label (Spot, OI…)  | 10–10.5px  | 400 mono | 0.06–0.08em | UPPERCASE    |
| State pill                   | 10px mono  | 500     | 0.08em       | UPPERCASE    |
| Keycap (`Kbd`)               | 10px mono  | 400     | normal       | As-is        |
| Terminal column header       | 10.5px mono| 500     | 0.06em       | UPPERCASE    |

Tabular numerics (`tnum`) on every numeric run.

---

## 5. Spacing, radii, elevation

### 5.1 Spacing

Tailwind's 4px base. Common patterns:
- Inline icon-to-label gap: `gap-1` (4px) or `gap-1.5` (6px)
- Card padding: `p-4` (16px)
- Form field padding: `px-3 py-1.5` for buttons, `px-2 py-1` for chips
- Header height: `h-12` (48px)
- Toolbar button height: `h-7` (28px)
- Switch: `w-7 h-4` track, `w-3 h-3` knob

### 5.2 Radii

| Radius      | Tailwind     | Used for                              |
| ----------- | ------------ | ------------------------------------- |
| 4px         | `rounded`    | Chips (sm), pill keycap               |
| 6px         | `rounded-md` | Buttons, toolbar buttons, chips (md)  |
| 12px        | `rounded-xl` | Modal cards                           |
| 999px       | `rounded-full` | Status dot, switch track, scrollbar |

### 5.3 Elevation

Sparing. The product has almost no shadows.
- **Modal card** — `0 24px 64px rgba(0,0,0,0.6)` (heavier on dark); softer on light themes.
- **Side panel** (Paper/Frost only) — `-1px 0 0 line, -16px 0 40px rgba(0,0,0,0.06)`.
- **Header underline** (Paper/Frost only) — `0 1px 0 line` instead of a hard border.
- **Connected status dot** — `0 0 8px #4ade80` glow on the pos dot when WS is connected.

No shadows on table cells, no shadows on chips/pills/buttons.

### 5.4 Borders

`1px solid` of `line` or `line-2`. Light themes also use `box-shadow: inset 1px 0 0 …` for subtle column rules (the custom column in the option chain table). Avoid `border-2` — if a 1px line isn't loud enough, change the color, not the width.

---

## 6. Components

### 6.1 Buttons

**Primary** (`PrimaryBtn`) — solid accent background, dark text on dark theme (`text-black`), white text on light themes (forced via override). Used sparingly: "Save", "Apply", primary CTA in modals.
```
bg-accent, text-black (or #fff on light), h-auto (px-3 py-1.5), rounded, text-xs, font-semibold
disabled → bg-bg-3, text-ink-4
```

**Ghost** (`GhostBtn`) — transparent, `border-line`, `text-ink-2`, hover `bg-bg-3`. Default action button.

**Toolbar** (`ToolbarButton`) — `h-7`, `border-line-2`, `text-ink-2`. Active state: `bg-bg-3 text-ink border-accent`. The Rules/Columns/Ask triggers in the header use this. Pad `px-2` on mobile, `px-2.5` ≥sm.

### 6.2 Chips (inline references)

Small monospaced tokens that appear inside rule/column descriptions. Five kinds (see §3.5). Always `font-mono`, always bordered, always low-alpha fill. Two sizes: `sm` (11px / `rounded`) and `md` (12px / `rounded-md`).

### 6.3 State pills

Status badges, 10px monospaced uppercase with 0.08em tracking. Five tones. Used for "Live", "Parsed", "Error", etc. Tone-fill + tone-border + tone-text.

### 6.4 Switch

Pill toggle, `w-7 h-4` track. Off → `bg-bg-4`, on → `bg-accent`. White `w-3 h-3` knob slides between `left-0.5` and `left-[14px]`. 150ms ease transition. No label inside the switch.

### 6.5 Keycap (`Kbd`)

Mono, `bg-bg-3`, `border-line-2`. Two sizes (9px xs, 10px sm). Used in the command palette and tooltips: `⌘ K`, `Esc`, `↵`.

### 6.6 Modal

- Portaled to `<body>`.
- Backdrop: `bg-black/50 backdrop-blur-sm`, click outside to dismiss.
- Card: `bg-bg-1`, `border-line-2`, `rounded-xl`, `min(width, 92vw)`, `max-h: 76vh`, opens at `pt-12vh`.
- Header: `h-12`, 13px semibold title + optional 10.5px mono mono-tone subtitle, `border-b border-line`.
- Close button: `w-7 h-7 rounded-md`, ghost hover.
- Body: scrolls, `p-4`.

### 6.7 Header layout

48px tall, three-column flex:
1. **Left** — brand wordmark + symbol (`12.5px` semibold mono, `-0.01em`).
2. **Middle** — Spot / Vol / OI tickers. Each is `UPPERCASE 10.5px mono ink-3` label + `tnum` value; spot tinted `pos`/`neg`. Hidden labels on mobile; the connected dot collapses into the right group.
3. **Right** — Theme cycler, expand toggle (Wide/Slim), and toolbar triggers (Rules, Columns, Ask).

Right side hides label text below `md` and shows icons only. The header pads `pr-[394px]` when a side panel is open (panel slides over from the right at 378px wide).

### 6.8 Option chain table

The product's signature surface. Layout:
- **CALL columns** (LTP, Change %, Vol, IV, OI, OI change) — left half.
- **Strike** — centered, identity column. Spot row gets a horizontal divider (a 1px line through the strike row at ATM).
- **PUT columns** — right half, mirrored.
- **Custom column** — appears at the far right with a faint left rule (`inset 1px 0 0` of `line` at 60% alpha).

Theme-specific table behavior:

| Behavior                       | Clean | Terminal | Paper / Frost |
| ------------------------------ | ----- | -------- | ------------- |
| Per-row borders                | No    | Yes      | No            |
| Group separator every 5 rows   | Faint | Same as per-row | Faint  |
| ITM gradient (call/put sides)  | None  | Yes      | None          |
| Header case                    | Sentence | UPPERCASE small-cap | Sentence |
| Header font                    | Sans  | Mono     | Sans          |
| ATM band                       | Soft tint | 1px inset ring | Soft tint |

**Cell flash** — on tick:
- Dark themes: `flash-up` HSL 140°/70%/50% at 35% alpha for 700ms, `flash-dn` HSL 0°/70%/50% at 35%.
- Light themes: lighter variants at 16–18% alpha.

---

## 7. Motion

Restrained. Three reusable animations:

| Animation    | Duration | Use                                          |
| ------------ | -------- | -------------------------------------------- |
| `pulse-soft` | 2.5s loop | Live status dot when WS connected           |
| `flash-up`   | 700ms    | Cell got a higher value                      |
| `flash-dn`   | 700ms    | Cell got a lower value                       |
| Theme fade   | 400ms    | Body background/color on theme switch       |
| Switch knob  | 150ms    | Toggle position                              |
| Panel slide  | 300ms    | Side panel padding shift on header           |

No spring physics, no bounce, no easing beyond `ease-out`.

---

## 8. When designing a new surface

Checklist for keeping a new screen on-system:

1. **Pick the role, not the hex.** "What surface depth is this?" → `bg-1` for a card, `bg-2` for a hover row, `bg-3` for a pressed chip. Then trust the theme to map it.
2. **Use the type scale.** If a label feels like it needs a new size, it probably wants a different existing role — try `ink-3` 10.5px UPPERCASE before adding 14px ink.
3. **One accent at a time.** A surface either has accent CTAs *or* accent text — not both. The accent color is for the single interactive thing the user is meant to do next.
4. **Numerics are mono with `tnum`.** No exceptions in tabular contexts. Body prose can be sans.
5. **Borders before shadows.** A 1px `line` does the job in 95% of cases. Reach for shadow only for floating layers (modal, panel) or the live dot's glow.
6. **Tone via existing pos/warn/neg/accent.** Don't invent a sixth color. If a state doesn't fit, the state is wrong.
7. **Test on Paper first.** It's the most punishing for contrast bugs — anything saturated will scream. If it works on Paper and Terminal, it works.

---

## 9. Quick reference (copy into Figma/Canva)

**Dark accent palette (Clean / Terminal):**
- Surfaces: `#0a0b0e` `#0e1014` `#14171c` `#1b1f26` `#242932`
- Ink: `#e6e8eb` `#a8aeb8` `#6c7480` `#4a515b`
- Lines: `#1f242c` `#2a3038`
- Pos / Neg / Accent: `#4ade80` `#f87171` `#6ea8ff`

**Light accent palette (Paper):**
- Surfaces: `#f6f3ed` `#fbf9f5` `#efece5` `#e6e2d8` `#d9d4c7`
- Ink: `#1c1d1f` `#4a4d52` `#888c92` `#b4b6ba`
- Lines: `#e3dfd3` `#d2cdbf`
- Pos / Neg / Accent: `#167d3a` `#c2331a` `#2563eb`

**Light accent palette (Frost):**
- Surfaces: `#f7f8fa` `#ffffff` `#f1f3f6` `#e7eaf0` `#d6dae3`
- Ink: `#0f1115` `#44495a` `#7a8294` `#b1b7c4`
- Lines: `#e8ebf0` `#d4d9e2`
- Pos / Neg / Accent: `#16a34a` `#dc2626` `#1d4ed8`

**Type:** IBM Plex Sans + Mono · Inter Tight + JetBrains Mono · Instrument Sans/Serif + Geist Mono · JetBrains Mono (mono-only). All numerics `tnum`.
