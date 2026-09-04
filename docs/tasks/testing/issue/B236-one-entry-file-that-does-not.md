---
id: B236
title: One entry file that does not parse throws out of getAllEntries, so the whole trip stops reading rather than that one day
type: ISSUE
priority: medium
complexity: low
area: entries, reading
found: "2026-09-04T08:04:38Z"
started: "2026-09-04T16:07:51Z"
merged: "2026-09-04T16:25:43Z"
---

# B236 — One entry file that does not parse throws out of getAllEntries, so the whole trip stops reading rather than that one day

## Why

Found while building B208, and measured rather than assumed. B208 says the
consequence of an entry that does not parse is that the day is "invisible at
every reading path". It is worse than that, and B208's Why has been corrected
to say so and to point here.

`readAllEntries` (`lib/entries.ts:148`) maps every `.md` in the trip's
`entries/` through `matter(raw)` with no guard. gray-matter throws on invalid
YAML, so **one bad file takes the whole trip with it**: `getAllEntries`,
`getDays`, `getEntryBySlug`, `getPlaces`, `getTripStats` and everything built
on them — the trip page, the feed, the sitemap, the search index — all raise
instead of returning what they can.

Observed directly, on a trip holding one good entry and one whose title quote
is unterminated:

```
getAllEntries("alex/asia-2026")
→ THREW: unexpected end of the stream within a double quoted scalar at line 3, column 1
```

The good entry is not returned. B208 closed the one door that could write such
a file through the API, so what is left is a person editing a file by hand,
which is the supported way to use this software — and the failure they get is
a trip that has disappeared rather than a day that has.

`getTrips`/`getTrip` have the equivalent guard for malformed `trip.md` already
(see `test/malformed-trips.test.ts`), so the pattern to follow is in the
codebase.

## Work

Built as described, with one addition the original Work section did not
anticipate:

- `readAllEntries` (`lib/entries.ts`) now wraps `matter(raw)` per file in
  `try`/`catch`, matching `readTrip`'s "unparseable" branch in `lib/trips.ts`:
  first line of the error only, `console.warn`'d as
  `[entries] <ref>/entries/<file>: its frontmatter could not be parsed: …`,
  and the file is skipped (`flatMap` returns `[]` for it) rather than thrown.
  Every other entry in the trip is unaffected.
- `listDrafts` (`lib/api/entries.ts`) gets the identical guard — it iterates
  every file in `entries/` the same way `readAllEntries` does, so one broken
  draft was blanking the whole review queue, not just itself.
- `isPublished` (`lib/api/entries.ts`) gets a guard too, but answering a
  different question: it only ever reads the *one* file the caller named, so
  a parse failure there cannot punish reading of other days the way the two
  above could. What it decides on failure follows the codebase's own existing
  convention rather than inventing one: `isDraft` already treats anything
  that is not exactly `status: draft` as published, so "cannot be read at
  all" is answered the same way — `true` (published) — rather than thrown.
  This also means the DELETE route (`app/api/v1/[user]/trips/[trip]/days/
  route.ts`) asks for the *stronger* confirmation wording on a file it cannot
  parse, which is the safer of the two wrong guesses were it to guess.
- **Found while writing this fix, not anticipated by it**: gray-matter
  memoizes a parse *by raw content*, in a module-level object, for the life
  of the process — and it writes that cache entry *before* it parses. A call
  that throws leaves a half-built, non-throwing result sitting under the
  failing text's key, so the *next* call with byte-identical content (e.g.
  the same still-broken entry, re-read because a sibling file's edit changed
  the trip's cache signature) would silently get that stale result back
  instead of failing the same way twice — exactly the failure this ticket
  exists to prevent, reintroduced one layer down. Confirmed with a two-line
  repro (`matter(raw)` twice on identical unparseable content: throws, then
  doesn't). Fixed by adding `clearMatterCache()` in `lib/entries.ts` — a
  small typed wrapper around gray-matter's `matter.clearCache()`, which
  exists on the runtime export but is missing from its published `.d.ts` —
  exported and called from every catch above.
- **The owner-view question the original Work section asked about**:
  decided **not** to build a "this file exists and cannot be read" surface on
  the owner's own pages for this ticket. `getMalformedTrips` /
  `MalformedTrip` is the precedent (`lib/trips.ts`, surfaced in
  `app/[user]/trips/page.tsx` and `TripsIndexContent.tsx`), and it is a real
  feature: a locale key per reason across three languages
  (`content/locales/{en,de,hu}.json`), a `MalformedTripReason` union, and
  plumbing through the page that lists trips. The equivalent for entries
  would need the same shape, but per-entry rather than per-trip, and there
  can be dozens of entries in a trip against exactly one `trip.md` — worth
  building, but a materially bigger and separately-reviewable piece of work
  than this ticket's `complexity: low` budget, and the trip.md precedent
  itself shipped log-only first (pre-B83) before the UI followed. For now
  the `console.warn` on every guarded path here is the operator-facing half
  of B83's original two-step; the owner-facing half is a legitimate follow-up
  but not this ticket's to absorb.
- Two more places were found with the *same* unguarded-or-under-guarded
  `matter()` shape, in files this ticket does not touch. Not absorbed here —
  captured separately: **B312** (`lib/trips.ts`'s `readTrip` has the
  try/catch but not the `clearMatterCache()` half of this fix, so it is
  exposed to the exact stale-cache failure described above) and **B313**
  (`lib/plan.ts`'s `readPlanFile` has *no* guard at all, despite `getPlan`'s
  own doc comment claiming a malformed `plan.md` returns empty rather than
  throwing).

## Acceptance

- A trip holding one unparseable entry still serves its other days. Evidence:
  `test/malformed-entries.test.ts`, "a good entry is still read beside one
  that will not parse".
- A test writes a broken entry beside a good one and asserts the good one is
  read. Same test as above.
- `npm run verify` passes (build → tsc → eslint → vitest, in that order).
