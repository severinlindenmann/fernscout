---
id: B1053
title: The helper's tool list has outgrown the budget its own test set, and the fix is grouping
type: ISSUE
priority: high
complexity: medium
area: agent, helper
found: "2026-09-09T07:11:30Z"
---

# B1053 — The helper's tool list has outgrown the budget its own test set, and the fix is grouping

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

**Update, hours later: the ceiling was raised to 8,000 by B1049**, in a
parallel session, while this was being written. `main` is green again and
nothing is blocked — so read everything below as the standing argument for
grouping, not as a broken build. The numbers it cites are the ones that
prompted it.

`test/helper-thread.test.ts` measures the prompt plus the tool schemas and
asserts a ceiling. The list reached **~7,617 tokens against a ceiling of
6,500**, and `main` failed `npm run verify` until the raise.

Nothing did this wrong. Five tool-adding tickets merged inside about an hour —
B1024 (rates and budget), B1025 (invites, telling readers, channels), B1026
(settings, keys, credits, past conversations), B1027 (postcards and the
photobook), B1028 (the inbox, remove_photo, discard_file) — plus B906's
`find_day`. Each branch verified green against a `main` that did not yet carry
the others' tools, so every one of them was honest at the moment it was
measured, and the sum was nobody's to see. That is a fact about parallel
merges, not about any of those tickets.

**The ceiling should not be raised again, and the test says so itself**, in the
paragraph B1023 left above it when it raised the number to 6,500:

> So: raised once, deliberately, with room for the whole round rather than a
> raise per capability. **If this fails again, the answer is almost certainly
> not another raise** — it is that the list has grown past what a model can
> choose well from, and the fix is grouping, not budget. B930 is still open and
> this does not close it.

That prediction has now come true, one round later. The registry is ~48 tools.
The same paragraph already establishes that money is not the constraint — the
whole list costs a fraction of a rappen a turn — so this is not a cost ticket.
It is the choosing problem: a model picking among fifty tools picks worse than
one picking among seventeen, and the honesty counters are where that shows up.

## Work

Decide the grouping and then build it. The shape is a person's call, and the
options worth weighing are at least:

- **Two passes.** The model is offered a small set of *areas* — the directory
  `lib/helper/tools/areas/` already names them: days, trips, money, files,
  readers, journal — and only the chosen area's tools are expanded into
  schemas on the second turn. Costs a round trip; cuts the list a model
  chooses from to well under ten.
- **Relevance.** Offer the tools this conversation could plausibly need, from
  what the turn already knows — no trip in hand means no `set_budget`. Cheaper,
  but a wrong guess makes a capability invisible rather than merely unlikely,
  which is the failure mode B858 and B1038 are both about.
- **Merging tools that are one question.** Several pairs read as one thing to a
  person (`trip_costs`/`set_budget`/`set_rate`; `invites`/`revoke_invite`).
  Fewer, wider tools with an argument that says which way.

Whatever is chosen, keep the measurement: the test is the only thing that
noticed, and it noticed the same day.

Not doing: raising the ceiling again. B1049 already did it once — to 8,000,
in its own commit — which bought room for this round and is exactly the "raise
per capability" the 6,500 paragraph set out to stop. A third raise is not the
answer; the choosing problem is unaffected by the budget.

## Acceptance

- `npm run verify` passes on `main`.
- The number of tools a single model turn chooses among is materially smaller
  than the registry's total, and a test asserts that rather than the byte size
  alone.
- The honesty counters and `test/helper-tools.test.ts` still pass — grouping
  must not make a capability unreachable, which is the one way this fix is
  worse than the problem.

