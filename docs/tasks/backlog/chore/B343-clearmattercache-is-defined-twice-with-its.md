---
id: B343
title: clearMatterCache is defined twice, with its reasoning written out twice
type: CHORE
priority: low
complexity: low
area: trips, entries, plan
found: "2026-09-04T22:05:12Z"
---

# B343 — clearMatterCache is defined twice, with its reasoning written out twice

## Why

Found while merging B312.

`clearMatterCache()` now exists in two places:

- `lib/entries.ts:29`, exported, and imported from there by `lib/api/entries.ts`
  and — since B313 — `lib/plan.ts`;
- `lib/trips.ts:412`, a private copy added by B312.

The body is one line: `(matter as unknown as { clearCache: () => void }).clearCache()`.
The doc comment above it is fifteen, and it is the part that matters — it is
the explanation of why gray-matter caches a parse *before* it performs it, why
a throwing call therefore leaves a stale non-throwing result under the failing
bytes, and why every `catch` around `matter()` has to clear it. That reasoning
is now written out twice, in two different sets of words.

B312's decision was deliberate and is recorded in the code: `lib/entries.ts`
already imports `mediaWithOwner`, `parseTripRef` and `tripDir` from
`lib/trips.ts`, so importing back the other way would make the two modules
import each other. That is a real constraint and duplicating was the right
call for one ticket in flight.

It is still the shape AGENTS.md names outright: *a reference kept in two files
is a reference that disagrees with itself within a month*. The two comments
already differ in wording, and the next person to learn something about
gray-matter's cache will update one of them.

Nothing is broken. Both copies do the same thing and there are tests either
side of them — `test/malformed-plan.test.ts`, `test/trip-reparse.test.ts`,
and B236's. This is a tidy-up, filed rather than done because it touches three
modules that four parallel tickets had just finished editing, and because the
cycle it works around is a real design fact worth deciding on rather than
patching past in a merge.

## Work

Move it to a module that depends on nothing but `gray-matter` — the obvious
shape is a small `lib/matterCache.ts` — and have `lib/entries.ts`,
`lib/trips.ts` and (transitively) `lib/plan.ts` and `lib/api/entries.ts`
import it from there. No cycle is possible from a leaf module, so the
constraint that forced the duplicate disappears rather than being worked
around.

The doc comment moves with it and is written once. Leave a one-line pointer
where each `catch` calls it, the way `lib/plan.ts` and `lib/trips.ts` already
do, so a reader at the call site still knows why the call is there.

Keep `clearMatterCache` exported from `lib/entries.ts` as a re-export only if
something outside actually imports it from there; otherwise update the two
import sites and let it go, and run `npm run unused` afterwards — an
unreferenced re-export is exactly what knip is for.

Not doing: anything about the `catch` blocks themselves, or about
gray-matter's cache behaviour. Three tickets have now paid for understanding
it; this only stops the understanding being stored twice.

## Acceptance

- One definition of `clearMatterCache`, in a module that imports only
  `gray-matter`.
- Its reasoning appears once.
- `npm run unused` reports no new unused file, dependency or import.
- `npm run verify`.
