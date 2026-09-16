---
id: B1688
title: Retracting a photographs decline is written out four times instead of once
type: CHORE
priority: medium
complexity: low
area: Content model
found: "2026-09-13T19:10:38Z"
---

# B1688 — Retracting a photographs decline is written out four times instead of once

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Four call sites now each carry their own copy of "photographs arrived, so the
day must stop saying it has none":

- `lib/ingest/entry.ts` — `appendGallery`
- `lib/api/v2/days.ts` — `attachDayMedia`, via `withoutDeclinedMedia`
- `lib/api/entries.ts` — `attachGallery`, added by B1564 today
- `lib/api/v2/write.ts` — `clearDeclinedSections`, the general T6 retraction

**The history says why this is worth fixing rather than tolerating.** B1564
established it with `git log -S`: `appendGallery` got its retraction inline
during B1598, the commit that introduced the `declined` map at all.
`attachDayMedia` was written afterwards, so it had the convention from the
start. `attachGallery` predates both — and because it neither reads nor writes
`declined`, adding that field broke no compile and failed no test. It simply
sat there, quietly leaving days that claimed a gallery and no photographs at
the same time, until somebody noticed.

That is the shape of the risk: a fifth path added tomorrow inherits nothing.
Nothing fails, nothing warns, and the fault is invisible until a person reads
a day that contradicts itself.

## Work

One function that takes a day document and the section being answered, and
returns it with that decline retracted — the T6 rule in one place. The four
sites above call it.

`clearDeclinedSections` in `lib/api/v2/write.ts` is the closest thing to a
home already, but check before assuming: it works from the *raw incoming
patch*'s declined map, which is the right question for a wire write and the
wrong one for "bytes just landed on disk". If those are genuinely two
questions, say so and give the second one its own named function rather than
bending the first.

Not doing: changing any behaviour. Every site already retracts correctly today
— this is about there being one of it, so the fifth is free.

## Acceptance

A test that walks the codebase and fails if a path appends to a day's `media`
without routing through the shared retraction — the mechanical version of the
rule, so the next `attachGallery` cannot be written without it.
