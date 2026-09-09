---
id: B858
title: The two questions people ask most have no answer
type: FEATURE
priority: high
complexity: low
area: agent
superseded: "B900 deleted the confidence-scored intent registry this ticket is written against; lib/helper/tools.ts now carries trip_costs, and B1038 is the live retest of the photos phrasing."
found: "2026-09-07T17:11:06Z"
---

# B858 — The two questions people ask most have no answer

## Why

A Hungarian tester asked the ask box the three things she would naturally ask.
One worked; two returned `unknown` at 0.1 confidence:

| Asked | Result |
| --- | --- |
| "hogy hívják az utamat" (what is my trip called) | answered, in Hungarian, confidence 0.85 |
| "mibe került az út" (what did the trip cost) | `unknown` |
| "hol vannak a képeim" (where are my photos) | `unknown` |

She retested the cost question in English and got the same `unknown` at the same
confidence, which is the useful half of the finding: **this is not a translation
gap, it is two missing rows.** The registry has no intent for what a trip cost
and none for where somebody's photographs are.

Both are questions people ask constantly — the costs one is what a 47-year-old
opened the app to do, and "where's my stuff" is what a 23-year-old typed before
being answered with disk space (B829).

## Work

Two read rows in `lib/helper/intents.ts`:

- **trip cost** — what this trip has cost so far, from `getCostSummary`, and
  where to see the breakdown. It also disambiguates the `credits` row, which
  currently swallows "how much have I spent" (B782).
- **where my photographs are** — how many are on which days, and a link to the
  gallery. This is the row that stops "wheres my stuff" landing on storage
  (B829), which rewording alone failed to fix.

Both are reads, so neither can write anything wrong.

## Acceptance

"What did the trip cost" and "where are my photos" are answered, in the
language they were asked in.

## What happened instead — 2026-09-09

Re-validated before starting. The premise no longer holds.

**The registry this ticket asks for two rows in does not exist.** B900 deleted
the confidence-scored router (`lib/helper/intents.ts` is now only `REFUSALS`,
matched deterministically before any model call) and replaced it with
tool-calling in `lib/helper/tools.ts`. Its own doc comment says so:
*"the registry is gone and `lib/helper/tools.ts` is the only one."*

**The cost half is answered.** `trip_costs` (`lib/helper/tools.ts:562`) reads
`getCostSummary` and returns total, preparation, on-the-road, per-day and
by-category. The B782 collision this ticket worried about is guarded in prose
on the neighbouring tool: `account` is documented as *"Bytes only — never where
anything is."*

**The photos half may still be real, but it is now a different bug.** No read
tool answers "where are my photographs" — the closest is a per-day `photos`
count on `read_day`. That is a tool-calling behaviour to observe against a live
model, not a missing row in a deleted registry, and B1038 is already open to
gather exactly that evidence. Adding a row here would resurrect the dual-router
problem B900 was written to kill.

Closed as superseded rather than built. See B1038.
