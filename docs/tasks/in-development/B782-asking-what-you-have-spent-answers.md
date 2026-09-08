---
id: B782
title: Asking what you have spent answers with app credits
type: ISSUE
priority: medium
complexity: low
area: agent
found: "2026-09-07T14:24:47Z"
started: "2026-09-08T19:51:06Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:51:06Z"
---

# B782 — Asking what you have spent answers with app credits

## Why

Asked *"how much have i spent"*, the ask box answered **"9 credits left"**.

The person meant their trip's costs. The box heard the app's own internal
currency. Both are money, and only one of them is what somebody on a trip means
by "spent" — a word-sense collision the router cannot resolve because
`credits` is the only money-shaped row in the registry.

It will get worse rather than better: `add_cost` and a trip-costs read are both
planned, and then three rows are competing for the same sentence.

## Work

Rename the intent's own description so the model can tell them apart — the
`credits` row is about *what this journal has left to spend on the helper*, not
about money spent on a journey. Add the trip-costs read alongside it when costs
arrive in the helper, and make each description say which question it answers.

Until a costs row exists, the credits answer should say what it is: "Dein
Guthaben für diese Seite: 9. Was deine Reise gekostet hat, steht in der Reise
selbst."

## Acceptance

"How much have I spent" does not answer with a credit balance without saying
that is what it is.

## Found still real, now narrower

Filed 2026-09-07, before `trip_costs` existed as a tool at all — B898/B899
(2026-09-08) added it alongside `account` in the same registry, and B959
fixed it to read the trip as its owner. So the specific worry in Work
("`add_cost` and a trip-costs read are both planned... three rows competing
for one sentence") is stale: both rows exist now, as of this branch, with
their own separate `describe` strings.

What was still missing, and is what this branch fixes: neither description
named the other. `account`'s said "credits pay for the model, captions,
transcription and printing" and `trip_costs`'s said "what a trip has cost so
far" — distinguishable to a careful reader, but nothing told the model which
one is *not* the answer to "how much have I spent", which is exactly the
ambiguous phrasing from the report. Renamed neither tool (no need — the
names were never the collision) but cross-referenced the two `describe`
strings in `lib/helper/tools.ts`:

- `account`: "...printing, not a trip's money (trip_costs)."
- `trip_costs`: "What a trip has cost so far, not the journal's own credits
  (account): ..."

Both stayed under the 4,100-token prompt ceiling (`test/helper-thread.test.ts`
"the prompt and the tool list stay under forty-one hundred tokens" — trimmed
wording twice to fit within it).

No new UI string: `describe` is sent to the model in the system prompt only,
never rendered to a person, so no locale file changes are needed.

Added `test/helper-thread.test.ts` > "account and trip_costs each say which
question they answer, and name the other — B782", which fails against the
old descriptions (`toContain("trip_costs")` on `account.describe` failed) and
passes now.

What this does **not** cover: whether the live model actually routes "how
much have I spent" to `trip_costs` rather than `account` — that is a live
model's judgement call, not something a unit test proves. The cross-reference
in each description is the whole of what code can do here; a live check with
`test-with-personas` would be the way to actually observe routing.
