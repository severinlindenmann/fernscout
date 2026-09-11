---
id: B1450
title: The thread re-sends its whole 10,800-token prefix on every round
type: CHORE
priority: medium
complexity: low
area: helper cost
found: "2026-09-11T11:47:00Z"
---

# B1450 — The thread re-sends its whole 10,800-token prefix on every round

## Why

`rounds()` in `lib/helper/model.ts` sends `tools` + `threadSystemPrompt()` on
every round of every turn, at full price, and nothing in the codebase used
`cache_control`. Measured rather than estimated: the prefix is **~10,800
tokens** — the tool schemas are two thirds of it — and at 80 Rp/MTok that is
0.76 Rp *per round*.

The cost comment in the module said 0.3–1 Rp per turn and the ceiling test's
comment said the prompt was "≈1,500 tokens". Both are wrong, and in the same
direction: the ceiling test measures `tool.properties + describe`, which is not
what `toolSchemas()` puts on the wire, and the system prompt alone is ~3,460
tokens. A real two-round turn costs **1.88 Rp**.

Measured on the real API, same turn, three ways:

| | cost |
| --- | --- |
| as today | 1.876 Rp |
| cached, cold | 1.306 Rp |
| cached, warm | 0.297 Rp (84% off) |

The cold number is the interesting one: **a single turn pays for the cache
inside itself**, because round two reads what round one wrote. The saving does
not depend on the person answering within five minutes, which is what made this
worth doing at hobby volume where cross-turn warmth is rare.

Latency matters at least as much as the money here — this is a phone
conversation, and rounds two through four stop re-processing 10,800 tokens.

## Work

- One `cache_control` breakpoint on the system prompt in `rounds()`. Render
  order is tools → system → messages, so one marker covers both halves.
- Fold `cache_read_input_tokens` / `cache_creation_input_tokens` into what
  `book()` records. Without it the cached tokens vanish from the `usage` table
  and `/admin` **understates** the bill — worse than before the change. Folded
  in at face value it overstates slightly (a read bills at 0.1×), which is the
  safe direction; carries a `ponytail:` comment naming the real fix.
- **Not** doing the usage-table migration for separate cache columns. That is
  the honest accounting and it is a schema change with no product value at
  current volume; do it when a price turns on it.
- **Not** touching `writeDay`, `describePhotos`, `mapStatementColumns` or
  `findInJournal` — single-shot calls with small, mostly unique prompts.
- **Not** per-tool result budgets. The 20,000-char slice is a ceiling, not a
  typical size, and a starved tool result is what makes a model guess, which
  the honesty guards then catch at double cost.

## What was tested and rejected

- **A better model on the honesty retry.** The premise was that re-asking the
  same Haiku that just tripped `amiss()` is why turns end in the canned
  sentence. Measured against the twelve recorded bad answers in
  `test/helper-honesty.test.ts`, with the real server guard and real calls:
  Haiku 4.5 recovered **12/12**, Sonnet 5 recovered **9/12**. There is no
  headroom to buy. Sonnet's three misses were honest answers caught by a blunt
  guard — that is B1448.
- **`writeDay` on Sonnet 5.** Same notes, both models: both faithful, nothing
  invented on either side. Haiku's German prose was fuller; Sonnet's was closer
  to a transcription of the notes. No reason to pay three times as much.
- **A cheaper provider for `mapStatementColumns`, or a full provider switch.**
  Not attempted. Every recorded consent names Anthropic by provider and would
  be invalidated by design, and at this volume the saving is francs a month.

## Acceptance

- A real turn shows `cache_creation_input_tokens` > 4,096 on the first call and
  `cache_read_input_tokens` > 4,096 on the second. (Haiku 4.5 will not cache a
  prefix under 4,096 tokens and says nothing when it declines — if the prefix is
  ever cut below that, this silently stops working.)
- `npm run verify` green.
