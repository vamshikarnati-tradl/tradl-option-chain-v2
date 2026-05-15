// LLM tool-use loop eval — hits POST /api/ai/parse with 10 fixture queries,
// handles up to 1 round of clarification by replaying a pre-prepared user
// answer, and writes a markdown report next to this script.
//
// Run from packages/server so the workspace deps resolve:
//   cd packages/server && node scratch/eval-llm-tool-use.mjs
//
// Pre-flight: dev server must be running on http://localhost:4000 with
// ANTHROPIC_API_KEY set. The script does NOT pre-populate a snapshot —
// validation runs without a dry-run sample (parse + field allowlist +
// boolean-root still execute).

import {
  CATEGORY_CATALOG, FIELD_CATALOG, FUNCTION_CATALOG, SUBGROUP_CATALOG,
} from '../../shared/dist/index.js';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = process.env.EVAL_SERVER ?? 'http://localhost:4000';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, 'llm-tool-use-eval.md');

// ─── Build the LLM index (mirrors packages/client/src/core/llm-index.ts) ───

const GROUP_LABEL = {
  market: 'Market (shared)',
  callSide: 'Call side',
  putSide: 'Put side',
};

function buildLlmIndex(columns = []) {
  const liveFns = FUNCTION_CATALOG.filter((f) => f.status === 'live');
  const byCategory = new Map();
  for (const f of liveFns) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category).push(f);
  }
  const subgroupsByCategory = new Map();
  for (const sg of SUBGROUP_CATALOG) {
    if (!subgroupsByCategory.has(sg.category)) subgroupsByCategory.set(sg.category, []);
    subgroupsByCategory.get(sg.category).push(sg);
  }
  const categories = [];
  for (const cat of CATEGORY_CATALOG) {
    if (cat.enabledStatus !== 'live') continue;
    if (cat.id === 'data') continue;
    const fns = byCategory.get(cat.id) ?? [];
    if (!fns.length) continue;
    const subgroups = [];
    for (const sg of subgroupsByCategory.get(cat.id) ?? []) {
      const members = fns.filter((f) => f.subgroup === sg.name).map((f) => f.technicalName);
      if (!members.length) continue;
      subgroups.push({ name: sg.name, description: sg.description, functions: members });
    }
    categories.push({
      id: cat.id, name: cat.friendlyName, description: cat.kidDescription, subgroups,
    });
  }
  const fieldGroups = new Map();
  for (const g of ['market', 'callSide', 'putSide']) {
    fieldGroups.set(g, { group: g, label: GROUP_LABEL[g], fields: [] });
  }
  for (const f of FIELD_CATALOG) {
    fieldGroups.get(f.group).fields.push({ name: f.technicalName, description: f.description });
  }
  return {
    categories,
    fields: Array.from(fieldGroups.values()),
    columns: columns.map((c) => ({
      name: c.name, displayLabel: c.displayLabel, description: c.description, returnType: 'number',
    })),
  };
}

// ─── Fixture queries ───
//
// Each query carries:
//   - the user's input
//   - my expected expression (rough — fuzzy match accepted)
//   - my pre-prepared answer to replay if the model clarifies
//   - matchHints — strings that, if all present in the generated expression,
//     count as a structural match. Used because the model has range to pick
//     thresholds (80000 vs 100000 etc).

const QUERIES = [
  // ─── Vague (5) — should clarify or submit-with-options ───
  {
    n: 1,
    query: 'show me unusual options',
    expected: `abs(call_iv - put_iv) > 5  (or another anomaly rule)`,
    userAnswer: 'high IV strikes, both sides',
    matchHints: ['call_iv', 'put_iv'],
    intent: 'rule',
  },
  {
    n: 2,
    query: 'highlight the interesting strikes',
    expected: `put_oi > call_oi * 2  (or similar OI imbalance)`,
    userAnswer: 'where put OI is much bigger than call OI',
    matchHints: ['put_oi', 'call_oi'],
    intent: 'rule',
  },
  {
    n: 3,
    query: 'find the wall',
    expected: `call_oi == maxStrikes(call_oi)`,
    userAnswer: 'biggest call OI strike',
    matchHints: ['call_oi', 'maxStrikes'],
    intent: 'rule',
  },
  {
    n: 4,
    query: "where's the action today",
    expected: `call_volume > 50000 || put_volume > 50000`,
    userAnswer: 'high volume on either side',
    matchHints: ['call_volume', 'put_volume', '||'],
    intent: 'rule',
  },
  {
    n: 5,
    query: 'alert me to imbalance',
    expected: `put_oi / call_oi > 1.5 || put_oi / call_oi < 0.5`,
    userAnswer: 'PCR above 1.5 or below 0.5',
    matchHints: ['put_oi', 'call_oi', '/'],
    intent: 'rule',
  },

  // ─── Graduated complexity (5) — should terminate directly ───
  {
    n: 6,
    query: 'highlight strikes where call IV is above 16',
    expected: `call_iv > 16`,
    matchHints: ['call_iv', '>', '16'],
    intent: 'rule',
  },
  {
    n: 7,
    query: 'add a column for put-call ratio',
    expected: `put_oi / call_oi`,
    matchHints: ['put_oi', 'call_oi', '/'],
    intent: 'column',
  },
  {
    n: 8,
    query: 'show strikes where put OI is more than 3 times call OI',
    expected: `put_oi > call_oi * 3`,
    matchHints: ['put_oi', 'call_oi', '*', '3'],
    intent: 'rule',
  },
  {
    n: 9,
    query: 'highlight the strike with the maximum sum of call and put OI',
    expected: `(call_oi + put_oi) == maxStrikes((call_oi + put_oi))   (or sumOverStrikes/maxOverStrikes fold)`,
    matchHints: ['call_oi', 'put_oi'],
    intent: 'rule',
  },
  {
    n: 10,
    query: 'highlight the top 3 strikes by absolute IV skew where OI changed positively on both sides',
    expected: `topN(abs(call_iv - put_iv), 3) && call_oiChange > 0 && put_oiChange > 0`,
    userAnswer: 'IV skew means abs(call_iv - put_iv); inline it, no separate column',
    matchHints: ['topN', 'abs', 'call_iv', 'put_iv'],
    intent: 'rule',
  },
];

// ─── Match heuristic ───

function exprFromResult(result) {
  if (!result) return '';
  if (result.intent === 'rule')   return result.rule?.expression   ?? '';
  if (result.intent === 'column') return result.column?.expression ?? '';
  if (result.intent === 'ambiguous') {
    return '<ambiguous: ' + (result.options ?? []).map((o) => o.label).join(' / ') + '>';
  }
  return '';
}

function matchHits(expression, hints, expectedIntent, actualIntent) {
  if (!expression) return false;
  if (expectedIntent && actualIntent && expectedIntent !== actualIntent) return false;
  const lower = expression.toLowerCase();
  return hints.every((h) => lower.includes(h.toLowerCase()));
}

// ─── Server caller ───

const INDEX = buildLlmIndex();
const COLUMNS = [];

async function callParse(input, state) {
  const t0 = Date.now();
  const res = await fetch(`${SERVER}/api/ai/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input, index: INDEX, columns: COLUMNS,
      existingRules: [],
      ...(state ? { state } : {}),
    }),
  });
  const ms = Date.now() - t0;
  let body;
  try { body = await res.json(); } catch { body = { raw: await res.text() }; }
  return { ok: res.ok, status: res.status, body, ms };
}

// ─── Main loop ───

const rows = [];
let totalMs = 0;

for (const q of QUERIES) {
  console.log(`\n[${q.n}] "${q.query}"`);
  let llmResp1 = '';
  let userResp = '';
  let llmResp2 = '';
  let generatedExpr = '';
  let intent = '';
  let confidence = '';
  let matched = false;
  let note = '';
  let totalQueryMs = 0;

  const r1 = await callParse(q.query);
  totalQueryMs += r1.ms;
  totalMs += r1.ms;

  if (!r1.ok) {
    note = `HTTP ${r1.status}: ${r1.body?.error ?? 'unknown'} ${r1.body?.detail ? '— ' + r1.body.detail : ''}`;
    console.log(`  ! error: ${note}`);
  } else if (r1.body.kind === 'clarification') {
    llmResp1 = `clarification: "${r1.body.question}"`;
    userResp = q.userAnswer ?? '(no pre-prepared answer)';
    console.log(`  ? clarify: ${r1.body.question}`);
    console.log(`  > answering: ${userResp}`);
    if (q.userAnswer) {
      const r2 = await callParse(q.userAnswer, r1.body.state);
      totalQueryMs += r2.ms;
      totalMs += r2.ms;
      if (!r2.ok) {
        llmResp2 = `HTTP ${r2.status}: ${r2.body?.error ?? 'unknown'}`;
        note = `error on follow-up: ${r2.body?.detail ?? ''}`;
      } else if (r2.body.kind === 'clarification') {
        llmResp2 = `clarification 2: "${r2.body.question}"`;
        note = 'two clarification rounds — capped';
      } else {
        const result = r2.body.result;
        intent = result.intent;
        confidence = String(result.confidence);
        generatedExpr = exprFromResult(result);
        llmResp2 = `result (${intent}, conf=${confidence}): ${generatedExpr}`;
        matched = matchHits(generatedExpr, q.matchHints, q.intent, intent);
      }
    }
  } else {
    const result = r1.body.result;
    intent = result.intent;
    confidence = String(result.confidence);
    generatedExpr = exprFromResult(result);
    llmResp1 = `result (${intent}, conf=${confidence}): ${generatedExpr}`;
    matched = matchHits(generatedExpr, q.matchHints, q.intent, intent);
  }

  rows.push({
    n: q.n, query: q.query, expected: q.expected,
    llmResp1, userResp, llmResp2, generatedExpr, matched, note, ms: totalQueryMs,
  });
  console.log(`  ✓ done (${totalQueryMs}ms, match=${matched}${note ? ', ' + note : ''})`);
}

// ─── Markdown report ───

const escapeCell = (s) => String(s ?? '')
  .replace(/\|/g, '\\|')
  .replace(/\n/g, ' ')
  .replace(/`/g, '\\`');

const lines = [];
lines.push('# LLM Tool-Use Eval');
lines.push('');
lines.push(`Run: ${new Date().toISOString()}`);
lines.push(`Server: ${SERVER}`);
lines.push(`Model: claude-haiku-4-5  ·  Total wall time: ${totalMs}ms  ·  Queries: ${QUERIES.length}`);
lines.push('');
lines.push('Queries 1–5 are vague (clarification expected). Queries 6–10 are concrete with rising complexity.');
lines.push('');
lines.push('Match column is fuzzy: structural fingerprint (intent + key identifiers from `matchHints`).');
lines.push('A "no match" with a sensible expression means the model picked a different-but-valid form.');
lines.push('');
lines.push('## Results table');
lines.push('');
lines.push('| # | query | expected expression | llm response 1 | user response | llm response 2 | generated expression | match? |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  lines.push(
    '| ' + [
      r.n,
      escapeCell(r.query),
      escapeCell(r.expected),
      escapeCell(r.llmResp1),
      escapeCell(r.userResp),
      escapeCell(r.llmResp2),
      escapeCell(r.generatedExpr),
      r.matched ? 'yes' : 'no',
    ].join(' | ') + ' |',
  );
}
lines.push('');
lines.push('## Per-query detail');
lines.push('');
for (const r of rows) {
  lines.push(`### ${r.n}. ${r.query}`);
  lines.push(`- duration: ${r.ms}ms`);
  if (r.note) lines.push(`- note: ${r.note}`);
  lines.push(`- llm response 1: ${r.llmResp1 || '(none)'}`);
  if (r.userResp) lines.push(`- user response: ${r.userResp}`);
  if (r.llmResp2) lines.push(`- llm response 2: ${r.llmResp2}`);
  lines.push(`- generated expression: \`${r.generatedExpr}\``);
  lines.push(`- match: ${r.matched ? 'yes' : 'no'}`);
  lines.push('');
}

writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
console.log(`\nReport written to ${REPORT_PATH}`);
