# LLM Tool-Use Eval

Run: 2026-05-15T04:01:30.284Z (post-fix)
Server: http://localhost:4000
Model: claude-haiku-4-5  ·  Total wall time: 70417ms  ·  Queries: 10  ·  Avg latency: 7.0s

Queries 1–5 are vague (clarification expected). Queries 6–10 are concrete with rising complexity.

Match column is fuzzy: structural fingerprint (intent + key identifiers from `matchHints`).
A "no match" with a sensible expression means the model picked a different-but-valid form.

## Headline

8 / 10 produced valid, semantically aligned expressions. All 5 vague queries
triggered useful clarifying questions and resolved correctly after the
user answered. The two "no" rows (3, 10) are wrong-but-runnable, not
errors:

- Q3 generated `topN(call_oi, 1)` instead of `call_oi == maxStrikes(call_oi)`.
  Both are valid ways to find the strike with the highest call OI;
  `topN(_, 1)` is even idiomatic. The match heuristic doesn't credit it.
- Q10 dropped the `abs(call_iv - put_iv)` IV-skew computation and ranked
  by raw `call_iv` only — the model under-weighted the user's clarification
  ("inline abs(...), no separate column"). Its own confidence (0.45)
  reflected the uncertainty. This one is a genuine quality miss; the
  expression runs but doesn't answer the question.

## Bug fixed mid-run

The first run failed 4/10 with HTTP 502 — `stop_reason=end_turn` on vague
queries. The model was writing prose instead of calling a tool. Two fixes:

1. **Prompt**: added an explicit "Always end every turn with a tool call.
   Never reply with plain text." paragraph to both parse + refine system
   prompts ([packages/server/src/prompts/parse.ts](../src/prompts/parse.ts) and [refine.ts](../src/prompts/refine.ts)).
2. **Loop**: instead of throwing on `end_turn`, the loop now appends a
   user turn coaching the model back ("your reply was plain text … pick a
   tool and try again") and continues. Bounded by the existing
   `MAX_TOOL_ITERATIONS` cap. ([ai-parse.ts](../src/ai-parse.ts) +
   [ai-refine-expression.ts](../src/ai-refine-expression.ts).)

Post-fix run: 0 errors, all 10 queries terminated within the iteration cap.

## Results table

| # | query | expected expression | llm response 1 | user response | llm response 2 | generated expression | match? |
|---|---|---|---|---|---|---|---|
| 1 | show me unusual options | abs(call_iv - put_iv) > 5  (or another anomaly rule) | clarification: "Do you want to flag strikes with unusual *activity* (volume/OI spikes), unusual *pricing* (IV outliers), or unusual *structure* (imbalance)?" | high IV strikes, both sides | result (rule, conf=0.82): pctile(call_iv) > 75 && pctile(put_iv) > 75 | pctile(call_iv) > 75 && pctile(put_iv) > 75 | yes |
| 2 | highlight the interesting strikes | put_oi > call_oi * 2  (or similar OI imbalance) | clarification: "What makes a strike "interesting"? (e.g., high volume, extreme IV, outlier OI, near ATM, top liquidity?)" | where put OI is much bigger than call OI | result (rule, conf=0.75): put_oi > call_oi * 1.5 | put_oi > call_oi * 1.5 | yes |
| 3 | find the wall | call_oi == maxStrikes(call_oi) | clarification: "Find the call wall, put wall, or the side with the largest OI concentration?" | biggest call OI strike | result (rule, conf=0.95): topN(call_oi, 1) | topN(call_oi, 1) | no |
| 4 | where's the action today | call_volume > 50000 \|\| put_volume > 50000 | clarification: "Do you want to find strikes with high volume, high IV, high OI changes, or something else?" | high volume on either side | result (rule, conf=0.8): topN(call_volume, 10) \|\| topN(put_volume, 10) | topN(call_volume, 10) \|\| topN(put_volume, 10) | yes |
| 5 | alert me to imbalance | put_oi / call_oi > 1.5 \|\| put_oi / call_oi < 0.5 | clarification: "Do you mean call/put OI ratio imbalance, or IV (volatility) imbalance between calls and puts?" | PCR above 1.5 or below 0.5 | result (rule, conf=0.95): put_oi / call_oi > 1.5 \|\| put_oi / call_oi < 0.5 | put_oi / call_oi > 1.5 \|\| put_oi / call_oi < 0.5 | yes |
| 6 | highlight strikes where call IV is above 16 | call_iv > 16 | result (rule, conf=0.95): call_iv > 16 |  |  | call_iv > 16 | yes |
| 7 | add a column for put-call ratio | put_oi / call_oi | result (column, conf=0.95): put_oi / call_oi |  |  | put_oi / call_oi | yes |
| 8 | show strikes where put OI is more than 3 times call OI | put_oi > call_oi * 3 | result (rule, conf=0.95): put_oi > call_oi * 3 |  |  | put_oi > call_oi * 3 | yes |
| 9 | highlight the strike with the maximum sum of call and put OI | (call_oi + put_oi) == maxStrikes((call_oi + put_oi))   (or sumOverStrikes/maxOverStrikes fold) | result (rule, conf=0.95): call_oi + put_oi == maxOverStrikes(cross_call_oi + cross_put_oi) |  |  | call_oi + put_oi == maxOverStrikes(cross_call_oi + cross_put_oi) | yes |
| 10 | highlight the top 3 strikes by absolute IV skew where OI changed positively on both sides | topN(abs(call_iv - put_iv), 3) && call_oiChange > 0 && put_oiChange > 0 | clarification: "Should I first create a saved column for IV skew, then identify the top 3, or do you want a different approach?" | IV skew means abs(call_iv - put_iv); inline it, no separate column | result (rule, conf=0.45): topN(call_iv, 3) && call_oiChange > 0 && put_oiChange > 0 | topN(call_iv, 3) && call_oiChange > 0 && put_oiChange > 0 | no |

## Per-query detail

### 1. show me unusual options
- duration: 12363ms
- llm response 1: clarification: "Do you want to flag strikes with unusual *activity* (volume/OI spikes), unusual *pricing* (IV outliers), or unusual *structure* (imbalance)?"
- user response: high IV strikes, both sides
- llm response 2: result (rule, conf=0.82): pctile(call_iv) > 75 && pctile(put_iv) > 75
- generated expression: `pctile(call_iv) > 75 && pctile(put_iv) > 75`
- match: yes

### 2. highlight the interesting strikes
- duration: 6852ms
- llm response 1: clarification: "What makes a strike "interesting"? (e.g., high volume, extreme IV, outlier OI, near ATM, top liquidity?)"
- user response: where put OI is much bigger than call OI
- llm response 2: result (rule, conf=0.75): put_oi > call_oi * 1.5
- generated expression: `put_oi > call_oi * 1.5`
- match: yes

### 3. find the wall
- duration: 6892ms
- llm response 1: clarification: "Find the call wall, put wall, or the side with the largest OI concentration?"
- user response: biggest call OI strike
- llm response 2: result (rule, conf=0.95): topN(call_oi, 1)
- generated expression: `topN(call_oi, 1)`
- match: no

### 4. where's the action today
- duration: 10000ms
- llm response 1: clarification: "Do you want to find strikes with high volume, high IV, high OI changes, or something else?"
- user response: high volume on either side
- llm response 2: result (rule, conf=0.8): topN(call_volume, 10) || topN(put_volume, 10)
- generated expression: `topN(call_volume, 10) || topN(put_volume, 10)`
- match: yes

### 5. alert me to imbalance
- duration: 3789ms
- llm response 1: clarification: "Do you mean call/put OI ratio imbalance, or IV (volatility) imbalance between calls and puts?"
- user response: PCR above 1.5 or below 0.5
- llm response 2: result (rule, conf=0.95): put_oi / call_oi > 1.5 || put_oi / call_oi < 0.5
- generated expression: `put_oi / call_oi > 1.5 || put_oi / call_oi < 0.5`
- match: yes

### 6. highlight strikes where call IV is above 16
- duration: 2253ms
- llm response 1: result (rule, conf=0.95): call_iv > 16
- generated expression: `call_iv > 16`
- match: yes

### 7. add a column for put-call ratio
- duration: 3892ms
- llm response 1: result (column, conf=0.95): put_oi / call_oi
- generated expression: `put_oi / call_oi`
- match: yes

### 8. show strikes where put OI is more than 3 times call OI
- duration: 4386ms
- llm response 1: result (rule, conf=0.95): put_oi > call_oi * 3
- generated expression: `put_oi > call_oi * 3`
- match: yes

### 9. highlight the strike with the maximum sum of call and put OI
- duration: 9844ms
- llm response 1: result (rule, conf=0.95): call_oi + put_oi == maxOverStrikes(cross_call_oi + cross_put_oi)
- generated expression: `call_oi + put_oi == maxOverStrikes(cross_call_oi + cross_put_oi)`
- match: yes

### 10. highlight the top 3 strikes by absolute IV skew where OI changed positively on both sides
- duration: 10146ms
- llm response 1: clarification: "Should I first create a saved column for IV skew, then identify the top 3, or do you want a different approach?"
- user response: IV skew means abs(call_iv - put_iv); inline it, no separate column
- llm response 2: result (rule, conf=0.45): topN(call_iv, 3) && call_oiChange > 0 && put_oiChange > 0
- generated expression: `topN(call_iv, 3) && call_oiChange > 0 && put_oiChange > 0`
- match: no
