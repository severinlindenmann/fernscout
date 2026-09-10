---
id: B1262
title: The guard log names the first verdict while the person received the second pass's fallback
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper
found: "2026-09-10T10:06:00Z"
merged: "2026-09-10T10:35:15Z"
---

# B1262 — The guard log names the first verdict while the person received the second pass's fallback

## Why

`lib/helper/model.ts` (formerly ~1956-1975) froze the recorded `guard` value
from the *first* `amiss()` call, before the one retry ran. When the retry's
own draft trades one false claim for a *different* one — told "you claimed a
screen", the model's second attempt claims a write instead — the sentence
that actually reaches the person is `PLAINLY[again]`, keyed by the *second*
`amiss()` call's verdict, while the durable row (`helper_sessions.guard`)
still says the first check's name. The scenario-guards.md run (2026-09-09,
finding 1) pinned this at a live turn: first pass caught `"screen"`, retry
produced a plain write claim, `PLAINLY.claim` ("agent.nothingHappened")
shipped, and the row read `guard: "screen"`. Every reader of that column —
tests, docs, an operator diagnosing a live fault — reads it as "which rule
produced what the user read," and it answered a different question.

## Work

`answerInThread` now tracks the check that authored the delivered sentence
separately from the first pass's verdict (`caught`). When a retry's second
`amiss()` call also fails, `shipped` is overwritten with that second verdict
(`again`) before the row is written. When the retry recovers, there is no
second violation to name, so the first check that fired (and was corrected)
is still what is recorded — unchanged from before. The `ThreadAnswer.guard`
doc comment now says this explicitly, so the next reader does not have to
re-derive it from the code.

Not done: extending `PLAINLY`/`RETRY` with a `guardFinal` column, or logging
both the first and second verdict — the ticket only asked the column to be
true, and a second column nobody reads yet is exactly the kind of
speculative addition to avoid.

## Acceptance

`test/whatsapp-model-turn.test.ts`, "a turn whose retry trades one false
claim for another": scripted so pass one claims a chat screen (caught,
retried) and pass two claims a write with nothing pressed and nothing written
(a different check). The `helper_sessions` row for that turn now records
`guard: "claim"` — the check that authored what shipped — not `"screen"`.
