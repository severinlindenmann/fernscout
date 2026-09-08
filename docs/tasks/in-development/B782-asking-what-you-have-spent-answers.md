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
