---
id: B806
title: A credit is never named in francs anywhere a person reads
type: ISSUE
priority: medium
complexity: low
area: agent, credits, i18n
found: "2026-09-07T15:16:04Z"
started: "2026-09-07T16:22:31Z"
merged: "2026-09-07T16:50:56Z"
completed: "2026-09-09T16:47:38Z"
---

# B806 — A credit is never named in francs anywhere a person reads

## Why

A credit is never named in francs anywhere a person reads.

The 71-year-old tester found the price only by looking at data no person is
shown — `credits: {balance: 10, perEmail: 1}` — and the tier list buried in the
instructions written for an agent. Offered a send with no price attached, her
character's answer was to press nothing and put the phone down. She was being
offered something that would have cost about **20 rappen**.

B767 was right to take prices off the first screen. It did not follow that a
credit should be unexplained everywhere: a number with no unit is not
reassurance, it is an unknown, and an unknown is what makes a careful person
stop.

## Work

One sentence, where a price is first shown: what a credit is and roughly what
it costs in francs. `lib/credits/pricing.ts` has `TIERS` and is deliberately
client-safe for exactly this. It is a division, not a new concept.

Say it once, in the panel that first asks somebody to spend one — not on every
button, which is what B767 removed.

## Acceptance

The first time a person is asked to spend a credit, the screen says in their
own language what a credit is worth.
