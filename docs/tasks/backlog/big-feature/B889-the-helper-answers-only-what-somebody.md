---
id: B889
title: The helper answers only what somebody wrote a row for
type: FEATURE
priority: high
complexity: high
area: agent
found: "2026-09-07T18:24:55Z"
---

# B889 — The helper answers only what somebody wrote a row for

## Why

The owner used the helper and said, plainly, that it does not work — that it
answers almost nothing he asks, and that it should feel like an agent doing the
work and proposing, not a box that opens forms.

Measured the same afternoon against the live instance, seven ordinary German
sentences:

| said | answered |
| --- | --- |
| mach mir einen tag von gestern | opened the wizard |
| schreib den tag fertig | opened the wizard |
| zeig mir meine reisen | one trip's dates |
| **wie geht das hier** | unknown |
| **ich war in lissabon** | unknown |
| **was kostet das** | unknown |
| **füge ein foto hinzu** | unknown |

Four of seven.

**This is the architecture working as designed, not a defect in it.** B685 built
a router over a registry: the model picks one of a fixed list of rows, and
`unknown` is a first-class answer precisely so a wrong guess never happens. That
is why B817's misroute could be fixed by a table and why the whole thing costs a
third of a rappen a turn.

The cost is now visible. **A registry can only answer what somebody wrote a row
for.** "Ich war in Lissabon" is not a command and never will be — it is a person
telling their journal something — and a menu has nowhere to put it. Seven rows
is a menu with a text box in front of it.

The full argument, the design, the gates that must survive it and what would
say it was wrong are in `docs/plans/2026-09-07-helper-as-an-agent.md`. This
ticket is the work.

## Work

Round 1 of that plan, and only round 1: **a thread with read tools and no
writes.**

- Conversation state per journal, server-side.
- The model called with the conversation and a **tool list** rather than an
  intent list, restricted to reads: trips, unfinished days, a day's words, a
  trip's costs, storage, credits, who can read a trip.
- It answers in prose, in the person's own language.
- It writes nothing. No proposal, no confirmation, no credit spent on a write,
  because there is no write.

That alone answers "wie geht das hier", "was kostet das" and "zeig mir meine
reisen", which is three of the four failures above, and it is the cheapest
honest way to find out whether the direction is right before committing to
proposals and writes.

**Keep, unchanged:** the pre-router refusal table for removal language (B817) —
it must not depend on the model's judgement; the manual wizard and tiles, which
are what this falls back to and what works with the capability off; and every
gate in `2026-09-07-helper-everything.md`.

Not doing in this ticket: write tools, proposals, voice into the thread, or
removing anything that exists today.

## Acceptance

A person can ask the four sentences above and get a true answer in their own
language, and nothing in the journal can be changed by the conversation.
