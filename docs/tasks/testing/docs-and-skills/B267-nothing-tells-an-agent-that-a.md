---
id: B267
title: Nothing tells an agent that a trip decides its own budget and coordinates, and an empty costs page is offered anyway
type: DOCS
priority: medium
complexity: medium
area: trips, costs, agent docs
found: "2026-09-04T11:35:51Z"
started: "2026-09-04T13:56:45Z"
merged: "2026-09-04T14:22:02Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T08:24:23Z"
---

# B267 — Nothing tells an agent that a trip decides its own budget and coordinates, and an empty costs page is offered anyway

## Why

Two gaps in what an agent is told at trip creation, both found on 2026-09-04
against fernscout.ch, plus one thing the site does with the answer.

**Coordinates.** Fifteen days were written with no `lat`/`lng` at all. The
owner had to ask for them afterwards, at which point the agent had no endpoint
to add them (B266) and no coordinates to add — it had never asked. A day
without coordinates is a day that is on no map, and the maps are most of what
this software renders: it broke them outright until B265. The trip-creation
guidance never mentions coordinates, so an agent working from a written journal
with place names in it has no reason to think they are wanted. It should ask,
and — where the prose names a real place — offer coordinates for the owner to
confirm rather than leaving the field empty. It must not silently invent a
location nobody named; that is the one rule.

**Budget.** A trip either accounts for its money or does not. `costs.md` is
optional (AGENTS.md, the content model) and `features.costs` is a journal-level
switch, but nothing tells an agent that this is a decision to put to the owner,
or that saying yes means per-day cost figures that somebody has to supply.
So it is neither asked nor mentioned.

**And the page is offered regardless.** `viki`'s journal nav renders
`Story · Gallery · Map · Costs · Trips · Search` on a journal with **no trips
and no budget** — verified by fetching `/viki/trips` signed out. "Costs" leads
somewhere with nothing in it. Off must mean *absent*, which is this
repository's own rule for every optional capability (AGENTS.md, *"Every
optional capability is off by default and must be absent rather than broken
when disabled"*) — and here the capability is on by default at creation
(`lib/journals.ts:232`) while the content that gives it meaning does not
exist.

## Work

1. **Ask about the budget at trip creation.** Add it to the trip-creation
   guidance in `lib/api/agentCopy.ts` so both documents get it: on or off, what
   "on" costs the owner in effort — a figure per day, from them, not guessed —
   and that off means the costs page is not there at all rather than empty.
2. **Ask for coordinates.** Same place: a day is expected to carry `lat`/`lng`,
   what they are for, and that an agent working from prose that names a place
   should propose coordinates for confirmation instead of omitting them. State
   plainly that an unconfirmed guess is not written — an empty field beats an
   invented location.
3. **Hide the costs page when there is nothing to cost.** Find where the
   journal nav is built and drop the entry when the journal has no `costs.md`
   anywhere, alongside the existing capability check. Then make the page itself
   answer honestly for a direct visit rather than rendering an empty shell —
   check what it does today before choosing between a 404 and a sentence.
4. Check the same question for the other nav entries on an empty journal —
   Gallery and Map are equally empty on `viki` — and either fix them the same
   way or capture what is left, by id.

Not in scope: B265 (the NaN a missing coordinate causes) and B266 (that there
is no way to add one afterwards). This is the half that stops the situation
arising.

## Acceptance

- Both documents ask the budget question and the coordinates question at trip
  creation, and say what each answer commits the owner to.
- A journal with no `costs.md` does not show "Costs" in its nav, and a direct
  visit to the costs URL does something defensible rather than rendering empty.
- A journal with a `costs.md` is unchanged.
- Tests for the nav in both states.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
