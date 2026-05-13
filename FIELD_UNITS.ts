// FIELD_UNITS.ts
//
// Single source of truth for option-chain data-point semantics.
// Keep this file in sync between backend (data plane / emitter) and frontend
// (display / rule engine). Every field the gateway emits has exactly one unit
// declared here; the backend MUST emit in that unit and the frontend MUST
// render assuming that unit. No silent conversions anywhere downstream.
//
// Companion doc: BACKEND_SCHEMA_PROPOSAL.md (next to this file).
//
// Architecture this file describes:
//
//   Two channels, two REST endpoints. All four carry option fields AND
//   greeks in a single payload.
//
//     WS   instrument.<u>.<expiry>           — whole chain (deltas)
//     WS   symbols.<symbol>.<expiry>         — one leg, fires per option tick
//     REST GET /v1/instrument/<u>/<expiry>   — whole chain (cold load)
//     REST GET /v1/symbol/<symbol>/<expiry>  — one leg (point fetch)
//
// To add a new field:
//   1. Add an entry to FIELD_SPEC below with the correct surface(s).
//   2. Update both backend emitter and frontend display layer in the same PR.
//   3. Update BACKEND_SCHEMA_PROPOSAL.md if the field is user-facing.

// ──────────────── Surfaces ────────────────
//
// A "surface" is a position inside a payload. A field can appear on more than
// one surface (e.g. `iv` is both inside `instrument.strikes[i].ce` and at the
// top of a symbol payload). Surface is structural, not channel-bound: the
// instrument REST snapshot and instrument WS frame share the same surfaces.

export type Surface =
  /** Top-level of an instrument payload: `underlying`, `expiry`, `underlying_ltp`, `asof`. */
  | 'instrument_envelope'

  /** Inside each entry of `strikes[]` on an instrument payload: `strike`, plus the `ce`/`pe` wrappers. */
  | 'instrument_strike'

  /** Inside `strikes[i].ce` or `strikes[i].pe` on an instrument payload: per-leg fields. */
  | 'instrument_leg'

  /** Flat top-level of a symbol payload — every per-leg field plus the envelope context. */
  | 'symbol_payload';

// ──────────────── Unit types ────────────────

export type Unit =
  /** Real number, no specific unit. Use only when no typed unit fits (e.g. gamma in 1/₹). */
  | { kind: 'number'; description: string }

  /** Integer count. Sign is meaningful (e.g. `oi_change` can be negative). */
  | { kind: 'integer'; description: string; signed?: boolean }

  /** A percentage represented as a NUMBER. `iv: 19.78` means 19.78%, NOT 0.1978. */
  | { kind: 'percent'; description: string; range?: [number, number]; decimals: number }

  /** Currency value. `decimals` = display precision. */
  | { kind: 'currency'; description: string; currency: 'INR'; decimals: number; signed?: boolean }

  /** Currency-per-unit (e.g. theta = ₹/day, vega = ₹/+1% IV). */
  | { kind: 'currency_per'; description: string; currency: 'INR'; per: string; decimals: number; signed?: boolean }

  /** Non-negative integer count (volume, OI, lot qty). */
  | { kind: 'count'; description: string }

  /** UTC milliseconds since epoch, as an integer. Machine-readable. */
  | { kind: 'timestamp_ms'; description: string }

  /** ISO 8601 string. Human-readable; prefer `timestamp_ms` for data plane. */
  | { kind: 'timestamp_iso'; description: string }

  /** String identifier — tradingsymbol, underlying ticker, expiry date string. */
  | { kind: 'identifier'; description: string }

  /** Constrained string enum. */
  | { kind: 'enum'; description: string; values: readonly string[] }

  /** Dimensionless ratio. delta is dimensionless 0..1 (calls) / -1..0 (puts). */
  | { kind: 'dimensionless'; description: string; range?: [number, number] };

export interface FieldSpec {
  /** Semantic unit. Drives formatting + rule-engine interpretation. */
  unit: Unit;

  /** Can the field arrive as JSON null? Server promises null, never absent / never empty string. */
  nullable: boolean;

  /** Sample value, in the declared unit. */
  example: unknown;

  /** Which surfaces this field appears on. Empty array would be a bug. */
  surfaces: ReadonlyArray<Surface>;
}

// ──────────────── The registry ────────────────

export const FIELD_SPEC = {
  // ─── Envelope context (top of instrument payload + top of symbol payload) ─

  underlying: {
    unit: { kind: 'identifier', description: 'Underlying index or equity ticker, e.g. "NIFTY".' },
    nullable: false,
    example: 'NIFTY',
    surfaces: ['instrument_envelope', 'symbol_payload'],
  },

  expiry: {
    unit: { kind: 'identifier', description: 'Expiry date, ISO YYYY-MM-DD.' },
    nullable: false,
    example: '2026-05-19',
    surfaces: ['instrument_envelope', 'symbol_payload'],
  },

  underlying_ltp: {
    unit: { kind: 'currency', description: 'Spot price of the underlying at emit time.', currency: 'INR', decimals: 2 },
    nullable: true,
    example: 23440.00,
    surfaces: ['instrument_envelope', 'symbol_payload'],
  },

  asof: {
    unit: { kind: 'timestamp_ms', description: 'Snapshot timestamp for this payload, UTC ms epoch integer.' },
    nullable: false,
    example: 1778646991462,
    surfaces: ['instrument_envelope', 'symbol_payload'],
  },

  // ─── Strike (inside strikes[i] of instrument + flat on symbol) ───────────

  strike: {
    unit: { kind: 'currency', description: 'Strike price.', currency: 'INR', decimals: 0 },
    nullable: false,
    example: 23450,
    surfaces: ['instrument_strike', 'symbol_payload'],
  },

  // ─── Symbol-only routing ─────────────────────────────────────────────────

  side: {
    unit: { kind: 'enum', description: 'Which leg this symbol represents. Avoids client-side parsing of the tradingsymbol suffix.', values: ['ce', 'pe'] },
    nullable: false,
    example: 'ce',
    surfaces: ['symbol_payload'],
  },

  // ─── Per-leg identity (inside ce/pe + flat on symbol) ────────────────────

  symbol: {
    unit: { kind: 'identifier', description: 'NFO tradingsymbol, e.g. "NIFTY2651923450CE".' },
    nullable: false,
    example: 'NIFTY2651923450CE',
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  exchange: {
    unit: { kind: 'enum', description: 'Derivatives exchange code.', values: ['NFO', 'BFO'] },
    nullable: false,
    example: 'NFO',
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  // ─── Per-leg option-side data (price / volume / depth / changes) ─────────

  ltp: {
    unit: { kind: 'currency', description: 'Last traded price.', currency: 'INR', decimals: 2 },
    nullable: true,
    example: 100.50,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  volume: {
    unit: { kind: 'count', description: 'Cumulative day traded volume (contracts).' },
    nullable: true,
    example: 12345,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  oi: {
    unit: { kind: 'count', description: 'Open interest (contracts).' },
    nullable: true,
    example: 67890,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  oi_change: {
    unit: { kind: 'integer', description: 'OI delta vs previous trading-day close. ABSOLUTE, NOT a percentage.', signed: true },
    nullable: true,
    example: 1234,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  net_change: {
    unit: { kind: 'currency', description: 'LTP delta vs previous trading-day close. ABSOLUTE, NOT a percentage.', currency: 'INR', decimals: 2, signed: true },
    nullable: true,
    example: -2.30,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  bid_qty: {
    unit: { kind: 'count', description: 'Top-of-book bid quantity (contracts).' },
    nullable: true,
    example: 195,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  bid_price: {
    unit: { kind: 'currency', description: 'Top-of-book bid price.', currency: 'INR', decimals: 2 },
    nullable: true,
    example: 100.25,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  ask_qty: {
    unit: { kind: 'count', description: 'Top-of-book ask quantity (contracts).' },
    nullable: true,
    example: 130,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  ask_price: {
    unit: { kind: 'currency', description: 'Top-of-book ask price.', currency: 'INR', decimals: 2 },
    nullable: true,
    example: 100.55,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  // ─── Per-leg greeks ──────────────────────────────────────────────────────
  //
  // All five (iv + the four greeks) appear on BOTH instrument legs and the
  // symbol payload. They are computed once upstream (~30 s cycle); the result
  // fans out to every surface. Surfaces MUST agree on values for the same
  // (symbol, asof) window — never diverge within a recompute cycle.

  iv: {
    unit: { kind: 'percent', description: 'Implied volatility (annualized). EMITTED AS PERCENT NUMBER — 19.78 means 19.78%, NOT 0.1978.', range: [0, 500], decimals: 2 },
    nullable: true,
    example: 19.78,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  delta: {
    unit: { kind: 'dimensionless', description: '∂(option price) / ∂(underlying). Calls: 0..1. Puts: -1..0.', range: [-1, 1] },
    nullable: true,
    example: 0.498,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  gamma: {
    unit: { kind: 'number', description: '∂(delta) / ∂(underlying) — per ₹ of underlying movement.' },
    nullable: true,
    example: 0.000658,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  theta: {
    unit: { kind: 'currency_per', description: 'Time decay — change in option price per calendar day.', currency: 'INR', per: 'day', decimals: 2, signed: true },
    nullable: true,
    example: -19.42,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },

  vega: {
    unit: { kind: 'currency_per', description: 'Vega — change in option price per +1.00 percent change in IV.', currency: 'INR', per: '+1% IV', decimals: 2, signed: true },
    nullable: true,
    example: 12.20,
    surfaces: ['instrument_leg', 'symbol_payload'],
  },
} as const satisfies Record<string, FieldSpec>;

export type FieldName = keyof typeof FIELD_SPEC;

// ──────────────── Surface lookups ────────────────
//
// Precomputed lists of which fields belong on each surface. Use these for
// ingestion (validate a payload contains exactly the expected fields), for
// emission (iterate the right set for the surface you're serializing), and
// for documentation.

function buildSurfaceIndex(): Record<Surface, FieldName[]> {
  const out: Record<Surface, FieldName[]> = {
    instrument_envelope: [],
    instrument_strike: [],
    instrument_leg: [],
    symbol_payload: [],
  };
  for (const name of Object.keys(FIELD_SPEC) as FieldName[]) {
    for (const s of FIELD_SPEC[name].surfaces) out[s].push(name);
  }
  return out;
}

export const FIELDS_BY_SURFACE: Readonly<Record<Surface, ReadonlyArray<FieldName>>> = buildSurfaceIndex();

// ──────────────── Formatting helpers ────────────────
//
// Centralized so the display layer renders a field once, the same way
// everywhere (table cells, hover tooltips, palette previews, exports).

const fmtINR = (n: number, dp: number, signed?: boolean): string => {
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return signed && n > 0 ? `+₹${s}` : `₹${s}`;
};

const fmtInt = (n: number): string => n.toLocaleString('en-IN');

export function formatField(name: FieldName, value: unknown): string {
  if (value == null) return '—';
  // Widen back to the parametric Unit — `as const satisfies` narrows each
  // entry to its literal shape, which drops optional members like `signed`.
  const u = FIELD_SPEC[name].unit as Unit;
  switch (u.kind) {
    case 'number':         return Number(value).toString();
    case 'integer':        return (u.signed && (value as number) > 0 ? '+' : '') + fmtInt(value as number);
    case 'percent':        return `${(value as number).toFixed(u.decimals)}%`;
    case 'currency':       return fmtINR(value as number, u.decimals, u.signed);
    case 'currency_per':   return `${fmtINR(value as number, u.decimals, u.signed)}/${u.per}`;
    case 'count':          return fmtInt(value as number);
    case 'timestamp_ms':   return new Date(value as number).toISOString();
    case 'timestamp_iso':  return String(value);
    case 'identifier':     return String(value);
    case 'enum':           return String(value);
    case 'dimensionless':  return (value as number).toFixed(3);
  }
}

// ──────────────── Runtime validation ────────────────
//
// Sanity helpers for ingestion. Throw on shape mismatches the schema
// guarantees (e.g. non-null where nullable: false, wrong primitive type,
// enum violation). Lightweight — not a full JSON-schema validator.

export function assertField(name: FieldName, value: unknown): void {
  const spec = FIELD_SPEC[name];
  if (value == null) {
    if (!spec.nullable) throw new Error(`Field "${name}" is non-nullable but got null/undefined`);
    return;
  }
  const u = spec.unit as Unit;
  switch (u.kind) {
    case 'number': case 'integer': case 'percent': case 'currency':
    case 'currency_per': case 'count': case 'dimensionless':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Field "${name}" expects finite number, got ${typeof value} ${String(value)}`);
      }
      break;
    case 'timestamp_ms':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error(`Field "${name}" expects integer ms epoch, got ${typeof value} ${String(value)}`);
      }
      break;
    case 'timestamp_iso': case 'identifier': case 'enum':
      if (typeof value !== 'string') {
        throw new Error(`Field "${name}" expects string, got ${typeof value}`);
      }
      if (u.kind === 'enum' && !u.values.includes(value as never)) {
        throw new Error(`Field "${name}" enum violation: ${value} not in ${u.values.join(',')}`);
      }
      break;
  }
}

// ──────────────── Surface validation ────────────────
//
// Verify a payload contains exactly the fields its surface expects. Useful
// during ingestion to catch backend drift early. Pass the parsed JSON object
// for the surface (e.g. `payload.strikes[0].ce` for `instrument_leg`).

export function assertSurface(surface: Surface, obj: Record<string, unknown>): void {
  const expected = new Set<string>(FIELDS_BY_SURFACE[surface]);
  // `instrument_strike` has structural `ce` / `pe` wrappers that aren't in
  // FIELD_SPEC (they're objects, not fields). Allow them through.
  const structural: Partial<Record<Surface, string[]>> = {
    instrument_strike: ['ce', 'pe'],
  };
  for (const k of structural[surface] ?? []) expected.add(k);

  const got = new Set(Object.keys(obj));
  for (const name of expected) {
    if (!got.has(name)) throw new Error(`Surface "${surface}" missing field "${name}"`);
  }
  for (const name of got) {
    if (!expected.has(name)) throw new Error(`Surface "${surface}" has unexpected field "${name}"`);
  }
  // Per-field type / nullability check.
  for (const name of expected) {
    if (FIELD_SPEC[name as FieldName]) {
      assertField(name as FieldName, obj[name]);
    }
  }
}
