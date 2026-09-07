---
id: B858
title: The two questions people ask most have no answer
type: FEATURE
priority: high
complexity: low
area: agent
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
