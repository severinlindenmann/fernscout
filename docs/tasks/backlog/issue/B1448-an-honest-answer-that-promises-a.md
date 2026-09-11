---
id: B1448
title: An honest answer that promises a button next turn is caught as a claim about this one
type: ISSUE
priority: high
complexity: medium
area: helper honesty guards
found: "2026-09-11T11:44:56Z"
---

# B1448 — An honest answer that promises a button next turn is caught as a claim about this one

## Why

AGENTS.md: *"A guard that fires on an honest turn is a bug, and as serious as
one that misses."* This is one, and it is latent today only because the model
in production happens to phrase its way around it.

`claimsAWrite` and `claimsAChatScreen` split the answer into sentences and ask,
per sentence, whether it matches `ON_SCREEN`/`CLAIM` with no `DENIED` clause
**in that same sentence** (`lib/helper/model.ts:850` and the matcher above it).
So an answer that denies in sentence one and promises a *future* button in
sentence two is caught, because the denial is out of scope by then:

> *"Noch ist nichts gespeichert. Sag mir, was genau ich festhalten soll — dann
> lege ich dir einen Vorschlag mit dem passenden Knopf vor."*

That is exactly the answer the product wants. It says plainly that nothing is
saved, asks the one question it needs, and describes what will happen next. The
guard reads *"Knopf"* in an undenied sentence, finds no proposal on the turn,
and replaces the whole thing with the canned `PLAINLY` sentence — so the person
loses a helpful clarifying question and gets a dead end instead.

Found by experiment, not by reading: a probe scripted the first pass with the
twelve answers recorded in `test/helper-honesty.test.ts`, then let the real
server run its own guard and its own retry against a real model. Haiku 4.5
recovered 12/12; Sonnet 5 recovered 9/12, and all three of its "failures" were
honest answers of the shape above. The difference is not honesty — it is that
the prompt has been tuned against Haiku's phrasing across B920–B1399, so Haiku
avoids a trap that is still there.

The cost of leaving it: any prompt edit, model change or new locale can move
phrasing into the trap, and the symptom is a person being stonewalled on a turn
where the software was working correctly. Nothing would report it.

## Work

- A denial anywhere in the answer should cover a promise about a *later* turn.
  Tense is the real signal — "ich lege dir … vor" / "dann bekommst du" /
  "I will put" is not a claim about this screen — but tense matching across
  three languages is the list that is always missing its next entry, so prefer
  widening the `DENIED` scope from the sentence to the answer for the
  `ON_SCREEN` half only, and keep `claimsAWrite` sentence-scoped (a write claim
  beside a denial is the B944 case and must stay caught).
- Whatever the shape, the twelve corpus answers must still be caught on the
  first pass: this is a change to what counts as *recovery*, not to what counts
  as a claim.
- Not in scope: changing models. That was tested and rejected — see B1450.

## Acceptance

- A test in `test/helper-honesty.test.ts` asserting that
  *"Noch ist nichts gespeichert. Sag mir, was genau ich festhalten soll — dann
  lege ich dir einen Vorschlag mit dem passenden Knopf vor."* is **not** caught,
  alongside the existing cases that must stay caught.
- The same for the English and Hungarian equivalents.
- `npm run verify` green.
