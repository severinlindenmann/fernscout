---
id: B1091
title: The two model calls that cost real money are free, so the ledger cannot account for what the instance spends
type: FEATURE
priority: high
complexity: medium
area: credits, helper, model, transcription
found: "2026-09-09T15:51:52Z"
started: "2026-09-11T06:40:35Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T06:40:35Z"
---

# B1091 — The two model calls that cost real money are free, so the ledger cannot account for what the instance spends

## Why

Five entry points in `lib/helper/model.ts` reach a provider. Four are charged
by their route: `writeDay` (1 credit), `describePhotos` (1 per 10),
`mapStatementColumns` (1), `transcribeAudio` (by the second, reconciled
against Deepgram's own measurement). **Two are free by decision** —
`answerInThread` behind `/api/helper/<user>/ask`, and `findInJournal` behind
`.../search`. Neither route calls `spend()`; `lib/rateLimit.ts` is the brake,
and `recordUsage` books the cost so the operator can see it on `/admin`.

The reasoning is written into both files and it is a good argument:

> **Free**, for the reason `ask` is free: at a fraction of a rappen a call, a
> front door that meters is a front door nobody knocks on.

**The owner has decided against it**, and the rule that replaces it is
narrower and easier to hold: *any external call that costs real money — a
model, a transcription — is charged to the journal. Only this instance's own
compute is free.* The goal is that every franc leaving the operator's account
can be linked back to somebody.

What that buys, and it is not nothing: `/admin` currently shows the operator a
cost with no corresponding debit anywhere, so the difference between "what the
instance spent" and "what journals were charged for" grows without bound and
has no name. After this, the two reconcile.

What it costs is exactly what the comments say — a front door with a price on
it. That is a product decision the owner has made with the argument in front
of them, and this ticket implements it rather than re-opening it.

**This reverses an answer given earlier the same day.** Asked whether the turn
should stay free on WhatsApp, the owner first said yes and then, on seeing the
whole picture, replaced it with the rule above. The later answer wins, and it
applies **everywhere — the web room and the messenger alike**, not only to the
new channel.

## Work

- **A flat price per turn: `0.02` credits**, about 0.4 rappen against a
  typical turn's third of a rappen. Credits carry two decimals since
  `027-credits-hundredths`, and `creditsForSeconds` already floors at `0.01`,
  so the granularity exists and needs no migration.
  - **Charged once per turn, not per model call.** A turn is up to four tool
    rounds plus a forced final answer, and a fired honesty guard retries the
    whole turn — so a worst case is roughly ten calls against one charge. The
    flat price under-recovers there deliberately: **a guard that misfires is
    our bug, and a person must not pay twice for it.**
  - `find_day` is a tool inside a turn and is therefore already covered. That
    is what makes leaving it unmetered correct rather than an oversight.
- **Spent before the call and refunded on a throw**, the pattern every other
  metered route follows (`day/write-day/route.ts:111` is the model to copy).
  Charging afterwards would be more accurate and would make a zero balance
  unrefusable, which is the property that matters more.
- **Its own `SpendReason`, not `helper`.** That value already covers
  `write_day`, the statement mapping and photo captioning. The codebase's own
  reasoning for splitting `digest` from `day_mail` applies exactly: the ledger
  is what an operator reconciles a provider bill against, and *"forty credits
  went on the helper last week"* is not an answer to *"how much of that was
  people talking versus days being written"*.
- **`/search` too**, at its own flat price. Same shape, same reason.
- **A zero balance refuses the model and answers anyway**, from a translated
  fixed string: what the balance is, what a turn costs, and the link to the
  payment page. Nothing that explains how to buy credits may itself need
  credits — otherwise an empty balance is a locked door with the key behind
  it. See B1058 for the general form: a reply about the *system* rather than
  about the *journal* does not need a model.
- **Rewrite both comments.** They currently argue at length for the opposite,
  and a file that argues against what it does is worse than one that says
  nothing. Say what is true now and why the earlier reasoning was set aside.
- **Check the opening state stays free.** `lib/helper/opening.ts` is described
  as the room's zero-cost opening; it must not start costing money to look at.
- **Keep the rate limits.** The balance is now a brake, but it is the
  journal's money and not a defence against somebody burning it. Both.

Worth stating for whoever prices it: the signup grant is 10 credits, which at
`0.02` is **500 turns** — a generous trial that costs the operator about CHF 1.70
in model calls at today's prices.

## Not doing

A free daily allowance. The owner considered one and deferred it: *"sure in the
future we can see if we give some more allowance"*. Capture it when it is
wanted rather than building a third rule now.

## Acceptance

No path reaches a provider without a debit against a journal, proved by a test
that walks every caller of the Anthropic and Deepgram clients the way
`test/credits.test.ts` walks `grant`; a journal at zero gets a sentence and a
link rather than silence or a 500; and `/admin`'s reported provider cost for a
period reconciles against the credits spent in it.
