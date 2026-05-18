// The single source of truth for every function the AST supports. Drives:
//   1. The expression parser's arity + arg-type validation.
//   2. The evaluator's dispatch.
//   3. The UI function picker (categories, hover cards, disabled states).
//   4. The LLM system prompt (what functions exist and how to use them).
//
// Adding a function = adding one record here + a body in the evaluator.

import type { NumericField } from './fields.js';

// ───── Public taxonomy types ─────

export type Category =
  | 'data'           // server payload + custom columns + constants
  | 'math'           // arithmetic
  | 'logic'          // if/then, and/or, count
  | 'crossStrike'    // other strikes in current snapshot
  | 'recentHistory'  // intraday: seconds to 5 minutes
  | 'pastDays';      // interday: 10 minutes to N days (backend service)

export type Status = 'live' | 'phase1' | 'phase2' | 'phase3';

export type ReturnKind =
  | 'number' | 'boolean' | 'integer' | 'percent' | 'rate'
  | 'strikeList'   // scope() returns this — a set of strikes for crossStrike fns to iterate over
  | 'strikeRef';   // firstStrike/lastStrike/onlyStrike return this — a single strike price

export type ArgKind =
  | 'expression'      // any sub-expression returning a number/boolean
  | 'fieldRef'        // a raw field name — NOT evaluated against current row
  | 'duration'        // a window literal like 5s, 1m, 1d
  | 'integer'         // a constant integer literal
  | 'historicalAgg'   // one of HISTORICAL_AGGS
  | 'scope'           // a scope(...) call producing a strike list
  | 'strikeRef';      // a strike reference (output of firstStrike/lastStrike/onlyStrike)

export interface ArgSpec {
  name: string;
  kind: ArgKind;
  description?: string;
  /** For 'duration' and 'historicalAgg': the allowed values. */
  allowed?: readonly string[];
}

export interface FunctionSpec {
  technicalName: string;
  friendlyName: string;
  category: Category;
  subgroup: string;
  kidDescription: string;
  /** Fixed positional args. */
  args: readonly ArgSpec[];
  /** Variadic tail (e.g. min/max/sum/avg). Args after the fixed positional ones. */
  rest?: { kind: ArgKind; description?: string; minCount: number };
  returns: ReturnKind;
  example: string;
  exampleMeaning: string;
  status: Status;
  /** True if evaluation requires the full snapshot, not just the current row. */
  isSnapshotAware: boolean;
  /** True if evaluation depends on time (forces recompute every tick). */
  isTimeAware: boolean;
  /** True if evaluation requires the backend history service. */
  isHistorical: boolean;
  /** True if the function accepts an optional trailing scope() argument that
   *  narrows the strikes it iterates over. Default: false. The 16 crossStrike
   *  functions all opt in. */
  acceptsScope?: boolean;
}

// ───── Duration literal vocabulary ─────

/** Windows the client's HistoryStore can serve. */
export const CLIENT_DURATIONS = [
  '1tick',
  '5s', '10s', '15s', '30s',
  '1m', '2m', '5m',
] as const;

/** Windows that require the backend history service (Phase 3). */
export const BACKEND_DURATIONS = [
  '10m', '15m', '30m',
  '1h', '2h', '5h',
  '1d', '2d', '5d', '10d', '15d',
] as const;

export const ALL_DURATIONS = [...CLIENT_DURATIONS, ...BACKEND_DURATIONS] as const;

export type DurationLiteral = (typeof ALL_DURATIONS)[number];

/** Aggregation modes for `historical()`. */
export const HISTORICAL_AGGS = [
  'EOD', 'AVG', 'MEDIAN', 'MAX', 'MIN', 'STDDEV', 'FIRST', 'LAST',
] as const;

export type HistoricalAgg = (typeof HISTORICAL_AGGS)[number];

/** Parse a duration literal into milliseconds. Returns null for invalid input. */
export function durationToMs(d: string): number | null {
  if (d === '1tick') return 0;
  const m = /^(\d+)(s|m|h|d)$/.exec(d);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    case 'd': return n * 86_400_000;
  }
  return null;
}

export function isClientDuration(d: string): boolean {
  return (CLIENT_DURATIONS as readonly string[]).includes(d);
}

export function isBackendDuration(d: string): boolean {
  return (BACKEND_DURATIONS as readonly string[]).includes(d);
}

// ───── The catalog ─────

const F = (s: FunctionSpec): FunctionSpec => s;

const ARG_FIELD: ArgSpec = { name: 'field', kind: 'fieldRef' };
const ARG_PERIOD_CLIENT: ArgSpec = {
  name: 'period', kind: 'duration', allowed: CLIENT_DURATIONS,
};
const ARG_PERIOD_BACKEND: ArgSpec = {
  name: 'range', kind: 'duration', allowed: BACKEND_DURATIONS,
};
const ARG_NUMBER = (name: string): ArgSpec => ({ name, kind: 'expression' });
const ARG_INT = (name: string): ArgSpec => ({ name, kind: 'integer' });

export const FUNCTION_CATALOG: readonly FunctionSpec[] = [
  // ───────── Math: single number ─────────
  F({
    technicalName: 'abs', friendlyName: 'Absolute Value',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'Strip the minus sign. -5 becomes 5.',
    args: [ARG_NUMBER('x')], returns: 'number',
    example: 'abs(call_netChange)', exampleMeaning: 'How big is the move, ignoring direction?',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'round', friendlyName: 'Round',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'Round to the nearest whole number.',
    args: [ARG_NUMBER('x')], returns: 'number',
    example: 'round(call_iv)', exampleMeaning: 'Call IV rounded to the nearest whole percent.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'floor', friendlyName: 'Round Down',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'Round down to the whole number below.',
    args: [ARG_NUMBER('x')], returns: 'number',
    example: 'floor(strikePrice / 100)', exampleMeaning: 'How many hundreds in the strike.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'ceil', friendlyName: 'Round Up',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'Round up to the whole number above.',
    args: [ARG_NUMBER('x')], returns: 'number',
    example: 'ceil(call_iv)', exampleMeaning: 'Call IV rounded up.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'sqrt', friendlyName: 'Square Root',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'Square root. The number that, multiplied by itself, gives this.',
    args: [ARG_NUMBER('x')], returns: 'number',
    example: 'sqrt(call_volume)', exampleMeaning: 'Square root of volume — used in some volatility models.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pow', friendlyName: 'Power',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'Multiply x by itself y times. pow(2, 3) is 2×2×2 = 8.',
    args: [ARG_NUMBER('x'), ARG_NUMBER('y')], returns: 'number',
    example: 'pow(call_iv, 2)', exampleMeaning: 'Call IV squared.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'log', friendlyName: 'Natural Log',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'Natural log. The exponent of e that gives this number.',
    args: [ARG_NUMBER('x')], returns: 'number',
    example: 'log(strikePrice / underlyingValue)', exampleMeaning: 'Log-moneyness — common in Black-Scholes math.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'exp', friendlyName: 'Exponential',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'e multiplied by itself x times.',
    args: [ARG_NUMBER('x')], returns: 'number',
    example: 'exp(call_iv / 100)', exampleMeaning: 'Continuous-compounding form of IV.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'sign', friendlyName: 'Sign',
    category: 'math', subgroup: 'Single number',
    kidDescription: 'Is it positive (+1), negative (-1), or zero (0)?',
    args: [ARG_NUMBER('x')], returns: 'integer',
    example: 'sign(call_netChange)', exampleMeaning: 'Is the call up or down?',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Math: many numbers (variadic) ─────────
  F({
    technicalName: 'min', friendlyName: 'Minimum',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'The smallest of these numbers.',
    args: [], rest: { kind: 'expression', minCount: 1 },
    returns: 'number',
    example: 'min(call_ltp, put_ltp)', exampleMeaning: 'The cheaper of the two legs.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'max', friendlyName: 'Maximum',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'The biggest of these numbers.',
    args: [], rest: { kind: 'expression', minCount: 1 },
    returns: 'number',
    example: 'max(call_oi, put_oi)', exampleMeaning: 'Whichever side has more open interest.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'sum', friendlyName: 'Sum',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'Add all the numbers together.',
    args: [], rest: { kind: 'expression', minCount: 1 },
    returns: 'number',
    example: 'sum(call_oi, put_oi)', exampleMeaning: 'Total open interest at this strike.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'avg', friendlyName: 'Average',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'Add them up, divide by how many. The average.',
    args: [], rest: { kind: 'expression', minCount: 1 },
    returns: 'number',
    example: 'avg(call_iv, put_iv)', exampleMeaning: 'Average IV between call and put.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'median', friendlyName: 'Median',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'Line them up smallest to biggest, take the middle one.',
    args: [], rest: { kind: 'expression', minCount: 1 },
    returns: 'number',
    example: 'median(call_iv, put_iv, abs(call_iv - put_iv))',
    exampleMeaning: 'Median of three IV measurements.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'stddev', friendlyName: 'Standard Deviation',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'How spread out the numbers are. Big = jumpy, small = tight.',
    args: [], rest: { kind: 'expression', minCount: 2 },
    returns: 'number',
    example: 'stddev(call_iv, put_iv)', exampleMeaning: 'Spread between call and put IV.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'variance', friendlyName: 'Variance',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'Standard deviation squared. Another spread measure.',
    args: [], rest: { kind: 'expression', minCount: 2 },
    returns: 'number',
    example: 'variance(call_iv, put_iv)', exampleMeaning: 'Variance of call and put IV.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'range', friendlyName: 'Range',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'Biggest minus smallest. How wide is the spread?',
    args: [], rest: { kind: 'expression', minCount: 2 },
    returns: 'number',
    example: 'range(call_ltp, put_ltp)', exampleMeaning: 'Difference between call and put price.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'product', friendlyName: 'Product',
    category: 'math', subgroup: 'Many numbers',
    kidDescription: 'Multiply all the numbers together.',
    args: [], rest: { kind: 'expression', minCount: 2 },
    returns: 'number',
    example: 'product(call_ltp, 1.05)', exampleMeaning: '5% above call price.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Math: adjustment ─────────
  F({
    technicalName: 'clamp', friendlyName: 'Clamp',
    category: 'math', subgroup: 'Adjustment',
    kidDescription: 'Trap a number between a floor and a ceiling. clamp(15, 0, 10) = 10.',
    args: [ARG_NUMBER('x'), ARG_NUMBER('lo'), ARG_NUMBER('hi')],
    returns: 'number',
    example: 'clamp(call_iv, 5, 50)', exampleMeaning: 'Bound IV between 5 and 50 percent.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'lerp', friendlyName: 'Linear Interpolation',
    category: 'math', subgroup: 'Adjustment',
    kidDescription: 'Mix two numbers by a percentage. Halfway from 0 to 100 is 50.',
    args: [ARG_NUMBER('a'), ARG_NUMBER('b'), ARG_NUMBER('t')],
    returns: 'number',
    example: 'lerp(call_bidPrice, call_askPrice, 0.5)', exampleMeaning: 'Midpoint between bid and ask.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Logic ─────────
  F({
    technicalName: 'ifelse', friendlyName: 'If/Else',
    category: 'logic', subgroup: 'Conditional',
    kidDescription: 'Pick A if the condition is true, B if false. Like a fork in the road.',
    args: [ARG_NUMBER('condition'), ARG_NUMBER('whenTrue'), ARG_NUMBER('whenFalse')],
    returns: 'number',
    example: 'ifelse(call_oi > put_oi, call_iv, put_iv)',
    exampleMeaning: 'Pick whichever side has more open interest.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'any', friendlyName: 'Any True',
    category: 'logic', subgroup: 'Count',
    kidDescription: 'True if AT LEAST ONE of these is true.',
    args: [], rest: { kind: 'expression', minCount: 1 },
    returns: 'boolean',
    example: 'any(call_volume > 50000, put_volume > 50000)',
    exampleMeaning: 'Either side had heavy volume.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'all', friendlyName: 'All True',
    category: 'logic', subgroup: 'Count',
    kidDescription: 'True ONLY IF ALL of these are true.',
    args: [], rest: { kind: 'expression', minCount: 1 },
    returns: 'boolean',
    example: 'all(call_oi > 10000, put_oi > 10000)',
    exampleMeaning: 'Both sides have meaningful open interest.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'count', friendlyName: 'Count True',
    category: 'logic', subgroup: 'Count',
    kidDescription: 'How many of these conditions are true.',
    args: [], rest: { kind: 'expression', minCount: 1 },
    returns: 'integer',
    example: 'count(call_iv > 20, put_iv > 20, abs(call_iv - put_iv) > 5)',
    exampleMeaning: 'How many IV alarms fired.',
    status: 'live', isSnapshotAware: false, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Cross-strike: scope (filter strikes) ─────────
  F({
    technicalName: 'scope', friendlyName: 'Scope (filter strikes)',
    category: 'crossStrike', subgroup: 'Scope',
    kidDescription: 'Pick which strikes count. The condition is checked for every strike; the function passing scope only sees the ones where it is true.',
    args: [{ name: 'predicate', kind: 'expression', description: 'A boolean condition checked per strike. Use strike_* to read the strike being checked.' }],
    returns: 'strikeList',
    example: 'chainSum(call_oi, scope(abs(strike_strikePrice - underlyingValue) <= 250))',
    exampleMeaning: 'Total call OI for strikes within 250 of spot (a window roughly ATM ±5 on a 50-wide chain).',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Cross-strike: pick one ─────────
  F({
    technicalName: 'atStrike', friendlyName: 'Value at Strike',
    category: 'crossStrike', subgroup: 'Pick one',
    kidDescription: 'Look up a value at a specific strike price.',
    args: [ARG_FIELD, ARG_NUMBER('strike')],
    returns: 'number', acceptsScope: true,
    example: 'atStrike(call_oi, 24000)', exampleMeaning: 'Call OI at the 24000 strike.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'atOffset', friendlyName: 'Value at Offset',
    category: 'crossStrike', subgroup: 'Pick one',
    kidDescription: 'Look up a value at the strike N rows above (or below if negative) this one.',
    args: [ARG_FIELD, ARG_INT('offset')],
    returns: 'number', acceptsScope: true,
    example: 'atOffset(call_oi, 1)', exampleMeaning: 'Call OI at the next strike up.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'atm', friendlyName: 'At-the-Money Value',
    category: 'crossStrike', subgroup: 'Pick one',
    kidDescription: 'The value at the at-the-money strike (closest to current spot).',
    args: [ARG_FIELD],
    returns: 'number', acceptsScope: true,
    example: 'atm(call_iv)', exampleMeaning: 'IV of the call closest to spot.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Cross-strike: single-strike picker (produces a strikeRef) ─────────
  F({
    technicalName: 'firstStrike', friendlyName: 'First Strike in Scope',
    category: 'crossStrike', subgroup: 'Single strike',
    kidDescription: 'The strike price of the FIRST strike that passes the scope. NaN if none match.',
    args: [{ name: 'scope', kind: 'scope' }],
    returns: 'strikeRef',
    example: 'firstStrike(scope(strike_call_oi == chainMax(call_oi)))',
    exampleMeaning: 'Strike price of the highest call-OI strike (lowest-index match if tied).',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'lastStrike', friendlyName: 'Last Strike in Scope',
    category: 'crossStrike', subgroup: 'Single strike',
    kidDescription: 'The strike price of the LAST strike that passes the scope. NaN if none match.',
    args: [{ name: 'scope', kind: 'scope' }],
    returns: 'strikeRef',
    example: 'lastStrike(scope(strike_call_oi == chainMax(call_oi)))',
    exampleMeaning: 'Strike price of the highest call-OI strike (highest-index match if tied).',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'onlyStrike', friendlyName: 'Only Strike in Scope',
    category: 'crossStrike', subgroup: 'Single strike',
    kidDescription: 'The strike price of the single strike in scope. Errors if zero or more than one match.',
    args: [{ name: 'scope', kind: 'scope' }],
    returns: 'strikeRef',
    example: 'onlyStrike(scope(strike_call_oi == chainMax(call_oi)))',
    exampleMeaning: 'Strike price of the strike with the highest call OI; errors if more than one strike ties for the max.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'evalAt', friendlyName: 'Evaluate at Strike',
    category: 'crossStrike', subgroup: 'Single strike',
    kidDescription: 'Evaluate an expression at a single chosen strike. Plain fields inside the expression refer to THAT strike.',
    args: [
      { name: 'expression', kind: 'expression', description: 'The expression to evaluate at the chosen strike.' },
      { name: 'strikeRef', kind: 'strikeRef', description: 'A strike reference (e.g., firstStrike(scope(...))).' },
    ],
    returns: 'number',
    example: 'evalAt(call_oi + put_oi, firstStrike(scope(strike_call_oi == chainMax(call_oi))))',
    exampleMeaning: 'Total OI at the highest call-OI strike.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Cross-strike: chain aggregators (value-producing) ─────────
  // Plain field names inside the body bind to the ITERATED strike (not the
  // outer row). These produce a single value per chain, suitable for the
  // value artifact type. Optional scope() narrows the iteration.
  F({
    technicalName: 'chainSum', friendlyName: 'Sum Across Chain',
    category: 'crossStrike', subgroup: 'Chain aggregator',
    kidDescription: 'Add the value of this expression for every strike. Plain field names refer to the strike being iterated.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'chainSum(call_oi)', exampleMeaning: 'Total call OI across the whole chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'chainAvg', friendlyName: 'Average Across Chain',
    category: 'crossStrike', subgroup: 'Chain aggregator',
    kidDescription: 'Average this expression across every strike. Plain field names refer to the strike being iterated.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'chainAvg(call_iv)', exampleMeaning: 'Mean IV across all strikes.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'chainMedian', friendlyName: 'Median Across Chain',
    category: 'crossStrike', subgroup: 'Chain aggregator',
    kidDescription: 'Median of this expression across every strike.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'chainMedian(call_iv)', exampleMeaning: 'Median IV across the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'chainMin', friendlyName: 'Min Across Chain',
    category: 'crossStrike', subgroup: 'Chain aggregator',
    kidDescription: 'Smallest value of this expression across all strikes.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'chainMin(call_iv)', exampleMeaning: 'Lowest call IV anywhere on the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'chainMax', friendlyName: 'Max Across Chain',
    category: 'crossStrike', subgroup: 'Chain aggregator',
    kidDescription: 'Biggest value of this expression across all strikes.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'chainMax(call_oi)', exampleMeaning: 'Largest call OI on the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'chainStddev', friendlyName: 'Spread Across Chain',
    category: 'crossStrike', subgroup: 'Chain aggregator',
    kidDescription: 'How spread out this expression is across strikes (population standard deviation).',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'chainStddev(call_iv)', exampleMeaning: 'How varied IVs are across strikes.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'chainProduct', friendlyName: 'Product Across Chain',
    category: 'crossStrike', subgroup: 'Chain aggregator',
    kidDescription: 'Multiply this expression across every strike. Useful for compound ratios.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'chainProduct(call_iv / 100 + 1)',
    exampleMeaning: 'Compound IV factor across the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'chainCount', friendlyName: 'Count Across Chain',
    category: 'crossStrike', subgroup: 'Chain aggregator',
    kidDescription: 'How many strikes make this true/false expression true?',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'integer', acceptsScope: true,
    example: 'chainCount(call_oi > 50000)',
    exampleMeaning: 'How many strikes have call OI above 50k.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Cross-strike: ranking ─────────
  F({
    technicalName: 'rank', friendlyName: 'Rank',
    category: 'crossStrike', subgroup: 'Ranking',
    kidDescription: 'What position is this strike in if you sort by this field? #1, #2, …',
    args: [ARG_FIELD], returns: 'integer', acceptsScope: true,
    example: 'rank(call_oi)', exampleMeaning: 'Position of this strike by call OI.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pctile', friendlyName: 'Percentile Rank',
    category: 'crossStrike', subgroup: 'Ranking',
    kidDescription: 'Percentile rank. Is this in the top 10%, top 50%?',
    args: [ARG_FIELD], returns: 'percent', acceptsScope: true,
    example: 'pctile(call_oi)', exampleMeaning: 'How high call OI is here vs other strikes.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'topN', friendlyName: 'In Top N?',
    category: 'crossStrike', subgroup: 'Ranking',
    kidDescription: 'Is this strike in the top N for this field? Yes/no.',
    args: [ARG_FIELD, ARG_INT('n')], returns: 'boolean', acceptsScope: true,
    example: 'topN(call_oi, 3)', exampleMeaning: 'Is this one of the top 3 by call OI?',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'bottomN', friendlyName: 'In Bottom N?',
    category: 'crossStrike', subgroup: 'Ranking',
    kidDescription: 'Is this strike in the bottom N? Yes/no.',
    args: [ARG_FIELD, ARG_INT('n')], returns: 'boolean', acceptsScope: true,
    example: 'bottomN(call_volume, 3)', exampleMeaning: 'Is this one of the 3 quietest calls?',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Cross-strike: pivot fold (per-row, uses outer-row context) ─────────
  // These iterate strikes from the perspective of each rendered row. Inside
  // the body: plain field names = OUTER row (the row being rendered);
  // `strike_*` fields/columns = the iterated strike. Use these to build
  // per-row max-pain, distance-weighted aggregations, etc.
  F({
    technicalName: 'pivotSum', friendlyName: 'Pivot Sum',
    category: 'crossStrike', subgroup: 'Pivot aggregator',
    kidDescription: 'For each rendered row, sum this expression across strikes. Use strike_* for the iterated strike and plain names for this row.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'pivotSum(abs(strike_strikePrice - strikePrice) * (strike_strikePrice > strikePrice ? strike_put_oi : strike_call_oi))',
    exampleMeaning: 'Max pain: total OI-weighted distance from each strike.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pivotAvg', friendlyName: 'Pivot Average',
    category: 'crossStrike', subgroup: 'Pivot aggregator',
    kidDescription: 'For each rendered row, average this expression across strikes.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'pivotAvg(strike_call_iv * strike_call_oi) / chainSum(call_oi)',
    exampleMeaning: 'Open-interest-weighted average call IV.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pivotMedian', friendlyName: 'Pivot Median',
    category: 'crossStrike', subgroup: 'Pivot aggregator',
    kidDescription: 'Median of this expression across strikes, per rendered row.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'pivotMedian(strike_call_iv)',
    exampleMeaning: 'Median call IV across the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pivotMin', friendlyName: 'Pivot Min',
    category: 'crossStrike', subgroup: 'Pivot aggregator',
    kidDescription: 'For each rendered row, take the smallest value of this expression.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'pivotMin(abs(strike_call_iv - strike_put_iv))',
    exampleMeaning: 'Smallest call/put IV gap on the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pivotMax', friendlyName: 'Pivot Max',
    category: 'crossStrike', subgroup: 'Pivot aggregator',
    kidDescription: 'For each rendered row, take the biggest value of this expression.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'pivotMax(strike_call_oi + strike_put_oi)',
    exampleMeaning: 'Highest total OI seen anywhere on the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pivotProduct', friendlyName: 'Pivot Product',
    category: 'crossStrike', subgroup: 'Pivot aggregator',
    kidDescription: 'Multiply this expression across every strike, per rendered row.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'pivotProduct(strike_call_iv / 100 + 1)',
    exampleMeaning: 'Compound IV factor across the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pivotStddev', friendlyName: 'Pivot Spread',
    category: 'crossStrike', subgroup: 'Pivot aggregator',
    kidDescription: 'How spread out this expression is, per rendered row.',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'number', acceptsScope: true,
    example: 'pivotStddev(strike_call_iv)',
    exampleMeaning: 'Spread of call IV across the chain.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),
  F({
    technicalName: 'pivotCount', friendlyName: 'Pivot Count Where',
    category: 'crossStrike', subgroup: 'Pivot aggregator',
    kidDescription: 'How many strikes make this true/false expression true, per rendered row?',
    args: [{ name: 'expression', kind: 'expression' }],
    returns: 'integer', acceptsScope: true,
    example: 'pivotCount(strike_call_oi > 50000)',
    exampleMeaning: 'How many strikes have call OI above 50k.',
    status: 'live', isSnapshotAware: true, isTimeAware: false, isHistorical: false,
  }),

  // ───────── Recent history: point in past ─────────
  F({
    technicalName: 'prev', friendlyName: 'Previous Value',
    category: 'recentHistory', subgroup: 'Point in past',
    kidDescription: 'What was this number some seconds or minutes ago?',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'prev(call_ltp, 1m)', exampleMeaning: 'Call price one minute ago.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'change', friendlyName: 'Change Since',
    category: 'recentHistory', subgroup: 'Point in past',
    kidDescription: 'Difference between now and then.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'change(call_oi, 5m)', exampleMeaning: 'How much call OI moved in 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'pchange', friendlyName: 'Percent Change',
    category: 'recentHistory', subgroup: 'Point in past',
    kidDescription: 'Percent change between now and then.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'percent',
    example: 'pchange(call_oi, 10m)', exampleMeaning: 'Percent change in call OI over 10 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),

  // ───────── Recent history: over a window ─────────
  F({
    technicalName: 'windowAvg', friendlyName: 'Moving Average',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'Average over the last N seconds/minutes.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowAvg(call_ltp, 1m)', exampleMeaning: 'Average call price over the last minute.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowSum', friendlyName: 'Window Sum',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'Sum over the last N seconds/minutes.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowSum(call_volume, 1m)', exampleMeaning: 'Total call volume in the last minute.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowMin', friendlyName: 'Window Min',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'Smallest value seen in the last N seconds/minutes.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowMin(call_ltp, 5m)', exampleMeaning: 'Lowest call price in the last 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowMax', friendlyName: 'Window Max',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'Biggest value seen in the last N seconds/minutes.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowMax(call_ltp, 5m)', exampleMeaning: 'Highest call price in the last 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowMedian', friendlyName: 'Window Median',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'Median over the recent window.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowMedian(call_iv, 1m)', exampleMeaning: 'Median call IV over the last minute.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowStddev', friendlyName: 'Window Standard Deviation',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'How wobbly it was in the recent window.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowStddev(call_ltp, 5m)', exampleMeaning: 'Volatility of call price in the last 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowFirst', friendlyName: 'Window First',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'First value at the start of the window.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowFirst(call_ltp, 5m)', exampleMeaning: 'Call price 5 minutes ago.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowLast', friendlyName: 'Window Last',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'Most recent value (basically now).',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowLast(call_ltp, 5m)', exampleMeaning: 'Latest call price within the last 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowRange', friendlyName: 'Window Range',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'Biggest minus smallest in the window.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'number',
    example: 'windowRange(call_ltp, 5m)', exampleMeaning: 'Price range over the last 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'windowCount', friendlyName: 'Window Count',
    category: 'recentHistory', subgroup: 'Over a window',
    kidDescription: 'How many ticks landed in the window.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'integer',
    example: 'windowCount(call_ltp, 1m)', exampleMeaning: 'How many ticks came in the last minute.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),

  // ───────── Recent history: patterns ─────────
  F({
    technicalName: 'crossedAbove', friendlyName: 'Crossed Above',
    category: 'recentHistory', subgroup: 'Patterns',
    kidDescription: 'Did the number rise above a line in the window?',
    args: [ARG_FIELD, ARG_NUMBER('threshold'), ARG_PERIOD_CLIENT],
    returns: 'boolean',
    example: 'crossedAbove(call_iv, 25, 5m)',
    exampleMeaning: 'Call IV crossed above 25 in the last 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'crossedBelow', friendlyName: 'Crossed Below',
    category: 'recentHistory', subgroup: 'Patterns',
    kidDescription: 'Did the number fall below a line in the window?',
    args: [ARG_FIELD, ARG_NUMBER('threshold'), ARG_PERIOD_CLIENT],
    returns: 'boolean',
    example: 'crossedBelow(call_ltp, 100, 1m)',
    exampleMeaning: 'Call price dropped below 100 in the last minute.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'trendUp', friendlyName: 'Trending Up',
    category: 'recentHistory', subgroup: 'Patterns',
    kidDescription: 'Has it been going up the whole window?',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'boolean',
    example: 'trendUp(call_oi, 5m)', exampleMeaning: 'Call OI rising for the last 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'trendDown', friendlyName: 'Trending Down',
    category: 'recentHistory', subgroup: 'Patterns',
    kidDescription: 'Has it been going down the whole window?',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'boolean',
    example: 'trendDown(call_oi, 5m)', exampleMeaning: 'Call OI falling for the last 5 minutes.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),
  F({
    technicalName: 'velocity', friendlyName: 'Velocity',
    category: 'recentHistory', subgroup: 'Patterns',
    kidDescription: 'How fast is it moving? Change per second.',
    args: [ARG_FIELD, ARG_PERIOD_CLIENT], returns: 'rate',
    example: 'velocity(call_oi, 1m)', exampleMeaning: 'Call OI change rate per second over a minute.',
    status: 'phase2', isSnapshotAware: false, isTimeAware: true, isHistorical: false,
  }),

  // ───────── Past days: specific day ─────────
  F({
    technicalName: 'eod', friendlyName: 'End-of-Day',
    category: 'pastDays', subgroup: 'Specific day',
    kidDescription: 'End-of-day close N days back.',
    args: [ARG_FIELD, ARG_INT('daysAgo')], returns: 'number',
    example: 'eod(call_ltp, 1)', exampleMeaning: "Yesterday's closing call price.",
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'sessionOpen', friendlyName: "Today's Open",
    category: 'pastDays', subgroup: 'Specific day',
    kidDescription: "Today's opening value.",
    args: [ARG_FIELD], returns: 'number',
    example: 'sessionOpen(call_ltp)', exampleMeaning: "Today's opening call price.",
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'sessionClose', friendlyName: 'Past Session Close',
    category: 'pastDays', subgroup: 'Specific day',
    kidDescription: 'Closing value N days back.',
    args: [ARG_FIELD, ARG_INT('daysAgo')], returns: 'number',
    example: 'sessionClose(call_ltp, 3)',
    exampleMeaning: 'Call closing price three trading days ago.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'sessionHigh', friendlyName: 'Past Session High',
    category: 'pastDays', subgroup: 'Specific day',
    kidDescription: 'Highest value reached on a past day.',
    args: [ARG_FIELD, ARG_INT('daysAgo')], returns: 'number',
    example: 'sessionHigh(call_ltp, 1)', exampleMeaning: "Yesterday's call high.",
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'sessionLow', friendlyName: 'Past Session Low',
    category: 'pastDays', subgroup: 'Specific day',
    kidDescription: 'Lowest value on a past day.',
    args: [ARG_FIELD, ARG_INT('daysAgo')], returns: 'number',
    example: 'sessionLow(call_ltp, 1)', exampleMeaning: "Yesterday's call low.",
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),

  // ───────── Past days: aggregate over days ─────────
  F({
    technicalName: 'yesterdayAvg', friendlyName: "Yesterday's Average",
    category: 'pastDays', subgroup: 'Aggregate over days',
    kidDescription: "Yesterday's average through the day.",
    args: [ARG_FIELD], returns: 'number',
    example: 'yesterdayAvg(call_ltp)', exampleMeaning: "Yesterday's average call price.",
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'daysAgoAvg', friendlyName: 'N Days Ago Average',
    category: 'pastDays', subgroup: 'Aggregate over days',
    kidDescription: 'Average value on a specific past day.',
    args: [ARG_FIELD, ARG_INT('n')], returns: 'number',
    example: 'daysAgoAvg(call_ltp, 5)', exampleMeaning: 'Average call price 5 days ago.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'nDayAvg', friendlyName: 'N-Day Average',
    category: 'pastDays', subgroup: 'Aggregate over days',
    kidDescription: 'Average across the last N days.',
    args: [ARG_FIELD, ARG_INT('n')], returns: 'number',
    example: 'nDayAvg(call_ltp, 5)', exampleMeaning: 'Average call price over the last 5 days.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'nDayHigh', friendlyName: 'N-Day High',
    category: 'pastDays', subgroup: 'Aggregate over days',
    kidDescription: 'Highest value across the last N days.',
    args: [ARG_FIELD, ARG_INT('n')], returns: 'number',
    example: 'nDayHigh(call_ltp, 5)', exampleMeaning: 'Highest call price in the last 5 days.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'nDayLow', friendlyName: 'N-Day Low',
    category: 'pastDays', subgroup: 'Aggregate over days',
    kidDescription: 'Lowest value across the last N days.',
    args: [ARG_FIELD, ARG_INT('n')], returns: 'number',
    example: 'nDayLow(call_ltp, 5)', exampleMeaning: 'Lowest call price in the last 5 days.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),

  // ───────── Past days: range of days ─────────
  F({
    technicalName: 'rangeMin', friendlyName: 'Min Over Date Range',
    category: 'pastDays', subgroup: 'Range of days',
    kidDescription: 'Smallest value between two past days.',
    args: [ARG_FIELD, ARG_INT('fromDays'), ARG_INT('toDays')], returns: 'number',
    example: 'rangeMin(call_ltp, 5, 1)',
    exampleMeaning: 'Lowest call price between 5 and 1 days ago.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'rangeMax', friendlyName: 'Max Over Date Range',
    category: 'pastDays', subgroup: 'Range of days',
    kidDescription: 'Biggest value between two past days.',
    args: [ARG_FIELD, ARG_INT('fromDays'), ARG_INT('toDays')], returns: 'number',
    example: 'rangeMax(call_ltp, 5, 1)',
    exampleMeaning: 'Highest call price between 5 and 1 days ago.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),

  // ───────── Past days: compare ─────────
  F({
    technicalName: 'compareToYesterday', friendlyName: 'Compare to Yesterday',
    category: 'pastDays', subgroup: 'Compare',
    kidDescription: "Percent up or down from yesterday's close.",
    args: [ARG_FIELD], returns: 'percent',
    example: 'compareToYesterday(call_ltp)',
    exampleMeaning: 'Percent change in call price vs yesterday.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
  F({
    technicalName: 'historical', friendlyName: 'Historical (Generic)',
    category: 'pastDays', subgroup: 'Compare',
    kidDescription: 'Generic: pull past data with your choice of aggregation.',
    args: [
      ARG_FIELD,
      ARG_PERIOD_BACKEND,
      { name: 'agg', kind: 'historicalAgg', allowed: HISTORICAL_AGGS },
    ],
    returns: 'number',
    example: "historical(call_ltp, 5d, 'AVG')",
    exampleMeaning: 'Average call price over the last 5 days.',
    status: 'phase3', isSnapshotAware: false, isTimeAware: false, isHistorical: true,
  }),
];

// ───── Lookup helpers ─────

const BY_NAME = new Map(FUNCTION_CATALOG.map((f) => [f.technicalName, f]));

export function getFunction(name: string): FunctionSpec | undefined {
  return BY_NAME.get(name);
}

/** All function names known to the catalog — used as the parser's allowlist. */
export function knownFunctionNames(): readonly string[] {
  return FUNCTION_CATALOG.map((f) => f.technicalName);
}

/** Arity bounds for a function (parser uses this to validate arg count).
 *  `acceptsScope: true` widens the max by 1 (the optional trailing scope arg). */
export function arityOf(spec: FunctionSpec): [number, number] {
  const fixed = spec.args.length;
  const scopeSlot = spec.acceptsScope ? 1 : 0;
  if (!spec.rest) return [fixed, fixed + scopeSlot];
  return [fixed + spec.rest.minCount, Infinity];
}

/** Whether the named function is currently executable. */
export function isLive(name: string): boolean {
  const spec = BY_NAME.get(name);
  return spec?.status === 'live';
}

// ───── Field metadata (used by the picker's Data category) ─────

export interface FieldSpec {
  technicalName: NumericField;
  friendlyName: string;
  group: 'callSide' | 'putSide' | 'market';
  description: string;
}

export const FIELD_CATALOG: readonly FieldSpec[] = [
  // Market
  { technicalName: 'strikePrice', friendlyName: 'Strike Price', group: 'market', description: 'The strike price of this row.' },
  { technicalName: 'underlyingValue', friendlyName: 'Underlying / Spot', group: 'market', description: 'Current spot value of the underlying index.' },
  // Call side
  { technicalName: 'call_oi', friendlyName: 'Call OI', group: 'callSide', description: 'Call open interest.' },
  { technicalName: 'call_oiChange', friendlyName: 'Call ΔOI', group: 'callSide', description: 'Change in call open interest since previous session.' },
  { technicalName: 'call_volume', friendlyName: 'Call Volume', group: 'callSide', description: 'Traded volume for calls today.' },
  { technicalName: 'call_iv', friendlyName: 'Call IV', group: 'callSide', description: 'Implied volatility of the call.' },
  { technicalName: 'call_ltp', friendlyName: 'Call LTP', group: 'callSide', description: 'Last traded price of the call.' },
  { technicalName: 'call_netChange', friendlyName: 'Call Net Change', group: 'callSide', description: 'Change in call LTP from previous close.' },
  { technicalName: 'call_bidQty', friendlyName: 'Call Bid Qty', group: 'callSide', description: 'Quantity at best bid.' },
  { technicalName: 'call_bidPrice', friendlyName: 'Call Bid', group: 'callSide', description: 'Best bid price for the call.' },
  { technicalName: 'call_askQty', friendlyName: 'Call Ask Qty', group: 'callSide', description: 'Quantity at best ask.' },
  { technicalName: 'call_askPrice', friendlyName: 'Call Ask', group: 'callSide', description: 'Best ask price for the call.' },
  { technicalName: 'call_delta', friendlyName: 'Call Δ', group: 'callSide', description: 'Call delta — price sensitivity to spot.' },
  { technicalName: 'call_gamma', friendlyName: 'Call Γ', group: 'callSide', description: 'Call gamma — rate of delta change.' },
  { technicalName: 'call_theta', friendlyName: 'Call Θ', group: 'callSide', description: 'Call theta — time decay.' },
  { technicalName: 'call_vega', friendlyName: 'Call ν', group: 'callSide', description: 'Call vega — IV sensitivity.' },
  // Put side
  { technicalName: 'put_oi', friendlyName: 'Put OI', group: 'putSide', description: 'Put open interest.' },
  { technicalName: 'put_oiChange', friendlyName: 'Put ΔOI', group: 'putSide', description: 'Change in put open interest since previous session.' },
  { technicalName: 'put_volume', friendlyName: 'Put Volume', group: 'putSide', description: 'Traded volume for puts today.' },
  { technicalName: 'put_iv', friendlyName: 'Put IV', group: 'putSide', description: 'Implied volatility of the put.' },
  { technicalName: 'put_ltp', friendlyName: 'Put LTP', group: 'putSide', description: 'Last traded price of the put.' },
  { technicalName: 'put_netChange', friendlyName: 'Put Net Change', group: 'putSide', description: 'Change in put LTP from previous close.' },
  { technicalName: 'put_bidQty', friendlyName: 'Put Bid Qty', group: 'putSide', description: 'Quantity at best bid.' },
  { technicalName: 'put_bidPrice', friendlyName: 'Put Bid', group: 'putSide', description: 'Best bid price for the put.' },
  { technicalName: 'put_askQty', friendlyName: 'Put Ask Qty', group: 'putSide', description: 'Quantity at best ask.' },
  { technicalName: 'put_askPrice', friendlyName: 'Put Ask', group: 'putSide', description: 'Best ask price for the put.' },
  { technicalName: 'put_delta', friendlyName: 'Put Δ', group: 'putSide', description: 'Put delta.' },
  { technicalName: 'put_gamma', friendlyName: 'Put Γ', group: 'putSide', description: 'Put gamma.' },
  { technicalName: 'put_theta', friendlyName: 'Put Θ', group: 'putSide', description: 'Put theta.' },
  { technicalName: 'put_vega', friendlyName: 'Put ν', group: 'putSide', description: 'Put vega.' },
];

// ───── Category metadata (UI picker headers + hover) ─────

export interface CategorySpec {
  id: Category;
  friendlyName: string;
  kidDescription: string;
  reachFor: string;
  /** Whether all functions in this category are currently runnable. */
  enabledStatus: Status;
}

export const CATEGORY_CATALOG: readonly CategorySpec[] = [
  {
    id: 'data',
    friendlyName: 'Data',
    kidDescription: 'All the numbers we know about the market right now. Like a scoreboard — each strike has its own row of numbers.',
    reachFor: 'Pick a market field, a custom column, or a constant.',
    enabledStatus: 'live',
  },
  {
    id: 'math',
    friendlyName: 'Math',
    kidDescription: 'Doing arithmetic — add, subtract, find the biggest, find the average. Like a calculator.',
    reachFor: 'Combine numbers, take averages, round things off.',
    enabledStatus: 'live',
  },
  {
    id: 'logic',
    friendlyName: 'Logic',
    kidDescription: 'Asking yes-or-no questions and combining them. Like saying "this AND that, but NOT the other thing."',
    reachFor: 'Wire conditions together with and/or, or pick one value vs another.',
    enabledStatus: 'live',
  },
  {
    id: 'crossStrike',
    friendlyName: 'Other strikes',
    kidDescription: 'Compare this strike to the rows above and below. Like asking "is my strike the highest?"',
    reachFor: 'Aggregate across strikes, peek at neighbours, or rank within the chain.',
    enabledStatus: 'live',
  },
  {
    id: 'recentHistory',
    friendlyName: 'Recent history',
    kidDescription: 'Look back a few seconds or minutes — what was this number then?',
    reachFor: 'Moving averages, percent changes, sudden movements within the session.',
    enabledStatus: 'phase2',
  },
  {
    id: 'pastDays',
    friendlyName: 'Past days',
    kidDescription: 'Look back to yesterday, last week, or further. What was this number on that day?',
    reachFor: 'Compare today to past sessions or aggregate across multiple days.',
    enabledStatus: 'phase3',
  },
];

// ───── Subgroup metadata (one-line description per category × subgroup) ─────
//
// Functions live in `${category}:${subgroup}` buckets. The picker derives
// subgroups from the function records themselves; this catalog adds a short
// description per bucket — used by the LLM tool-use index so the model can
// pick which buckets it needs without seeing every function's full spec.

export interface SubgroupSpec {
  category: Category;
  name: string;
  description: string;
}

export const SUBGROUP_CATALOG: readonly SubgroupSpec[] = [
  { category: 'math', name: 'Single number',
    description: 'Operate on one number: abs, round, sqrt, log, exp, sign, etc.' },
  { category: 'math', name: 'Many numbers',
    description: 'Reduce many numbers to one: min, max, sum, avg, median, stddev, variance, product.' },
  { category: 'math', name: 'Adjustment',
    description: 'Constrain or interpolate values: clamp, lerp.' },
  { category: 'logic', name: 'Conditional',
    description: 'Pick a value based on a condition: ifelse, ternary.' },
  { category: 'logic', name: 'Count',
    description: 'Count or quantify booleans: any, all, count.' },
  { category: 'crossStrike', name: 'Scope',
    description: 'Filter which strikes a cross-strike function operates on: scope(<predicate>). Used as an optional trailing argument.' },
  { category: 'crossStrike', name: 'Pick one',
    description: 'Read one value from another strike in the snapshot: atStrike, atOffset, atm.' },
  { category: 'crossStrike', name: 'Single strike',
    description: 'Pick a single strike from a scope (firstStrike/lastStrike/onlyStrike) and evaluate an expression at it via evalAt.' },
  { category: 'crossStrike', name: 'Chain aggregator',
    description: 'Collapse an expression to ONE number across strikes (no outer-row reads — suitable for the value artifact type): chainSum, chainAvg, chainMedian, chainMin, chainMax, chainStddev, chainProduct, chainCount.' },
  { category: 'crossStrike', name: 'Pivot aggregator',
    description: 'For each rendered row, aggregate an expression across strikes using `strike_*` references (column-producing): pivotSum, pivotAvg, pivotMedian, pivotMin, pivotMax, pivotStddev, pivotProduct, pivotCount.' },
  { category: 'crossStrike', name: 'Ranking',
    description: 'Rank or filter strikes by a field: rank, pctile, topN, bottomN.' },
  { category: 'recentHistory', name: 'Point in past',
    description: 'Read a field value from a moment ago (seconds to minutes). Phase 2 — not yet runnable.' },
  { category: 'recentHistory', name: 'Over a window',
    description: 'Aggregate over the recent intraday window. Phase 2 — not yet runnable.' },
  { category: 'recentHistory', name: 'Patterns',
    description: 'Detect intraday patterns: spikes, crossovers, runs. Phase 2.' },
  { category: 'pastDays', name: 'Specific day',
    description: 'Read a field from a past session. Phase 3 — needs backend service.' },
  { category: 'pastDays', name: 'Aggregate over days',
    description: 'Aggregate across multiple past sessions. Phase 3.' },
  { category: 'pastDays', name: 'Range of days',
    description: 'Sliding/lookback ranges over past sessions. Phase 3.' },
  { category: 'pastDays', name: 'Compare',
    description: 'Compare today vs an earlier session. Phase 3.' },
];

// ───── Comparator metadata (used by Filter Builder, not the function picker) ─────

export const COMPARATORS = ['>', '<', '>=', '<=', '==', '!='] as const;
export type Comparator = (typeof COMPARATORS)[number];

export const COMPARATOR_LABELS: Record<Comparator, string> = {
  '>':  'is greater than',
  '<':  'is less than',
  '>=': 'is greater than or equal to',
  '<=': 'is less than or equal to',
  '==': 'equals',
  '!=': 'does not equal',
};
