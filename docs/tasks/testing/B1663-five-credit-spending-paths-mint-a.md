---
id: B1663
title: Five credit-spending paths mint a fresh ref per call, so a retry charges again
type: ISSUE
priority: medium
complexity: medium
area: Credits
found: "2026-09-13T12:22:30Z"
merged: "2026-09-13T18:32:48Z"
---

# B1663 — Five credit-spending paths mint a fresh ref per call, so a retry charges again

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found while fixing B1659, which was the same bug in `buy_room`. These five
each mint their own ledger `ref` per call — several from `Date.now()` — with
**no idempotency guard at all**:

- `helper/ask` (`ask_thread`)
- `helper/search` (`find_in_journal`)
- WhatsApp's own `ask_thread`
- `lib/digest/dayWhatsapp.ts` (`day_whatsapp`)
- `lib/helper/transcribeSpend.ts` (`transcription`)

A retried request — a double-tap, a flaky connection, a client retry — spends
the person's credits again.

**The fix shape is not B1659's, which is why this is a separate ticket.**
`buy_room` buys a thing; the second press can be made a no-op that reports
what already happened, because nothing else was done. These five each trigger
**real work** — a model turn, a transcription, a message sent — so a ledger-
level guard alone would be wrong in both directions: it would either charge
for work already done twice, or skip the charge for work genuinely done twice.
This needs request-level dedup, and the codebase already has that layer:
`lib/idempotency` is what `travellers/from-photo`, `helper/statement`,
`day/write-day` and `day/describe-photos` use.

## Work

Bring the five onto `lib/idempotency` rather than inventing a second
mechanism. Decide, per path, what a repeat should return — the *previous
result* is usually right for a model turn, since the person asked one question
and should get one answer.

`lib/digest/dayWhatsapp.ts` deserves its own thought: it is triggered by a
publish rather than by a person pressing anything, so "retry" there means
something different, and double-sending a message is worse than double-
charging for it.

Not doing: `runCleanup`, which spends nothing and is naturally idempotent.

## Acceptance

For each of the five, a test that issuing the same request twice charges once
and does the work once. `recordUsage` still never throws — a person has
already been given what they paid for by the time accounting runs.
