---
id: B312
title: A malformed trip.md that gray-matter has already failed to parse once can silently succeed on re-parse
type: ISSUE
priority: medium
complexity: low
area: trips, reading
found: "2026-09-04T16:21:57Z"
started: "2026-09-04T19:26:10Z"
merged: "2026-09-04T19:39:05Z"
---

# B312 — A malformed trip.md that gray-matter has already failed to parse once can silently succeed on re-parse

## Why

Found while building B236, which guards `lib/entries.ts` and
`lib/api/entries.ts` against the same failure. `readTrip` in `lib/trips.ts`
(around line 438) already catches a `matter()` parse failure and reports it as
a `MalformedTrip` rather than throwing — that pattern is what B236 copied. But
neither `readTrip` nor B236's new guards accounted for a gray-matter behaviour
that undermines the catch itself:

`matter()` memoizes a parse **by raw content**, in a module-level object
(`matter.cache`, `node_modules/gray-matter/index.js`), for the life of the
process — and it writes that cache entry *before* it parses, not after. A call
that throws therefore leaves a half-built, non-throwing result sitting under
the failing text's key. The next call with byte-identical content gets that
stale object back — an empty `data` and the whole raw file folded into
`content` — instead of the same parse failure repeating.

Confirmed directly:

```
node -e '
const matter = require("gray-matter");
const raw = "---\ntitle: \"unterminated\n---\n\nx\n";
try { matter(raw); } catch (e) { console.log("1st:", e.message.split("\n")[0]); }
try { console.log("2nd:", JSON.stringify(matter(raw))); } catch (e) { console.log("2nd threw too"); }
'
1st: can not read a block mapping entry; a multiline key may not be an implicit key at line 3, column 1
2nd: {"data":{},"content":"---\ntitle: \"unterminated\n---\n\nx","...
```

For `readTrip`, `tripsSignature` (lib/trips.ts) is a fingerprint joined across
*every* trip folder in the journal — editing any trip's `trip.md` invalidates
the whole cache and forces every trip, including a still-broken one, to be
re-parsed. If that broken file's raw bytes are unchanged since its first
(correctly-caught) failure, the re-parse hits gray-matter's stale cache entry
instead of throwing again, and `readTrip` would build a `Trip` (or at least
not refuse the folder the same way) from the empty `data` gray-matter handed
back — silently un-reporting a trip that is exactly as broken as before,
the moment an unrelated trip in the same journal is edited.

This was caught as a test failure while writing B236's equivalent guards in
`lib/entries.ts` (`test/malformed-entries.test.ts`), which is what surfaced the
gray-matter behaviour in the first place; B236 fixed it there and in
`lib/api/entries.ts` with a shared `clearMatterCache()` helper
(`lib/entries.ts`) called from every catch around a `matter()` call. This
ticket is the same fix, not yet applied, for `lib/trips.ts`.

## Work

- In `readTrip`'s `catch (err)` (lib/trips.ts, the "unparseable" branch), call
  `matter.clearCache()` before returning the `refuse(...)` result — same
  reasoning as `clearMatterCache` in `lib/entries.ts`. **Done as a local
  duplicate, not an import**: `lib/entries.ts` already imports from
  `lib/trips.ts` (`mediaWithOwner`, `parseTripRef`, `tripDir`), so importing
  `clearMatterCache` the other way would make the two modules import each
  other. A 3-line function with the same doc comment and the same cast is a
  smaller cost than a module cycle between the two.
- Checked whether any other unguarded-but-caught `matter()` call in the
  codebase has the same shape (a `try`/`catch` around `matter()` with no
  `clearCache()`) — none does; `lib/entries.ts` and `lib/api/entries.ts`
  already call it at every catch site (B236), and this ticket's fix is the
  last one.
- **Found while checking that, and *not* fixed here**: `readTrip`'s own doc
  comment says `lib/plan.ts` "matches" this function by returning rather than
  throwing on a bad file — it doesn't. `readPlanFile` (lib/plan.ts:69) calls
  `matter()` with no `try`/`catch` at all, and `getPlan` is called directly
  from page components with none either, so a malformed `plan.md` throws
  uncaught and crashes the trip and map pages. That is a different failure
  mode (never caught, not caught-then-mis-cached) and is captured separately
  as B341 rather than folded in here.

## Acceptance

- A test: write a `trip.md` that fails to parse, confirm `getMalformedTrips`
  reports it; touch (or add) a sibling trip so `tripsSignature` changes and
  the malformed trip is forced through `readTrip` again with unchanged bytes;
  assert it is *still* reported as malformed rather than silently accepted.
  Done as `test/trip-reparse.test.ts`. Note on what "silently accepted" turned
  out to mean: on unfixed code the folder is *still* refused (an empty `data`
  from the stale gray-matter cache has no `id` either, so `readTrip`'s
  missing-id check still catches it) — but as the wrong reason,
  `"missing-id"` instead of `"unparseable"`, which is itself the bug the
  Why section describes as "or at least not refuse the folder the same way".
  The test pins the reason staying `"unparseable"` across the forced
  re-parse, confirmed failing (`"missing-id"`) before the fix and passing
  after.
- `npm run verify` passes.
