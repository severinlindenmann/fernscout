---
id: B839
title: Every journal the helper creates is priced in francs forever
type: ISSUE
priority: high
complexity: low
area: agent, signup, currency
found: "2026-09-07T16:07:37Z"
started: "2026-09-07T16:22:33Z"
merged: "2026-09-07T16:55:15Z"
---

# B839 — Every journal the helper creates is priced in francs forever

## Why

`baseCurrency` is:

- never asked by the helper's signup,
- never asked by `/agent.md`'s seven questions either,
- defaulted to **`CHF`** in `createJournal` (`lib/journals.ts:272-275`),
- **refused by `setJournalProfile`**, deliberately — it is what every cost in
  the journal is denominated against, and changing it later would silently
  re-price the past,
- and, per B790, not validated on creation at all.

So every journal made in the browser is priced in Swiss francs for ever, and
nobody was asked. For this instance's own owner that is right by accident. For
the German and Hungarian readers this instance maintains languages for, it is
wrong and permanent.

It only bites once somebody records a cost — but by then it is the one field
that cannot be corrected, and the honest fix is upstream: ask before writing a
value nobody can change.

Found by comparing the helper's signup against `/agent.md`'s onboarding script,
2026-09-07.

## Work

Ask it at signup, defaulting to the currency that matches the chosen language
or the instance's own, and say plainly that it cannot be changed afterwards —
the one place in this product where that sentence is warranted.

Then decide whether `/agent.md`'s script should carry the question too. An
agent creating a journal has exactly the same permanent choice and exactly the
same silence about it, so the answer is probably yes, and that makes this an
eighth question rather than a helper-only fix.

B790 is the validation half and should land with it: a currency that is not one
must be refused at creation, since it can never be corrected.

## Acceptance

Nobody ends up with a permanent currency they were never asked about, in the
helper or through the API.
