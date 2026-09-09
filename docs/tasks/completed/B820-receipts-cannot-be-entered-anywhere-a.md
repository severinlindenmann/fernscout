---
id: B820
title: Receipts cannot be entered anywhere a person can reach
type: FEATURE
priority: high
complexity: medium
area: agent, costs
found: "2026-09-07T15:30:52Z"
started: "2026-09-07T16:22:31Z"
merged: "2026-09-07T16:50:54Z"
completed: "2026-09-09T16:45:35Z"
---

# B820 — Receipts cannot be entered anywhere a person can reach

## Why

The costs page is good — budget against actual, a category breakdown, day by
day, converted to the journal's currency with the ECB rate cited. A tester
called it genuinely good.

**There is no way to put anything into it from a browser.** Entering a receipt
is `PATCH .../days/<slug>` with a `costs[]` array, or `PUT .../trips/<trip>/costs`
for the budget — agent or API only. The wizard's only relationship with money
is the tracks question, whose answers are "there was none" and "nobody knows".

So a person home from a trip with a shoebox of receipts has an excellent page
to read and no form to fill. This is roadmap gap 3, now with a witness.

## Work

The case that actually happens is one receipt at a time: an amount, a currency,
a label, a date, a category from the closed `COST_CATEGORIES` list. That is a
small form, and the plan's `add_cost` ask-box row is the other half of it —
"we spent forty euros on dinner" is a sentence somebody says.

The trip budget is a second, rarer thing and can wait.

Note B689 already reads a whole bank statement into costs; this is the manual
path for people who did not export anything.

## Acceptance

Somebody home with a receipt can put it on the right day from the browser, and
see it appear on the costs page.
