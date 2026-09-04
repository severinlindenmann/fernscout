---
id: B341
title: A malformed plan.md throws uncaught out of getPlan, crashing the trip and map pages
type: ISSUE
priority: medium
complexity: low
area: plan, trips
found: "2026-09-04T19:30:41Z"
superseded: "B313 — the same defect, fixed and merged the same hour"
---

# B341 — A malformed plan.md throws uncaught out of getPlan, crashing the trip and map pages

> **Superseded by B313, and never worked.** B313 is the same finding, captured
> earlier the same day and fixed in the same hour this was written:
> `readPlanFile` now catches the `matter()` failure, calls `clearMatterCache()`
> and returns no stops. The analysis below is correct and was correct when
> written — it is kept because it reached the conclusion independently and adds
> the direct node repro B313 did not have.
>
> **Why it was written at all is the part worth keeping.** Four tickets were
> built in parallel worktrees branched from one commit. This one and B313 both
> found the unguarded `matter()` in `lib/plan.ts`; B313 was already
> `in-development` in the shared checkout, but a worktree's `docs/tasks/` is
> the snapshot from when its branch was cut, so neither agent could see the
> other. AGENTS.md's rule — *never open a second task for something already
> listed* — is only as good as the listing each session can actually read.

## Why

Found while building B312, which fixed `readTrip`'s (lib/trips.ts) catch
around a `matter()` parse failure so a broken `trip.md` cannot silently start
reading as valid on re-parse. `readTrip`'s own doc comment claims its
return-rather-than-throw approach is "matching lib/plan.ts", implying
`lib/plan.ts` handles an unparseable file the same way. It does not.

`readPlanFile` (lib/plan.ts:69) calls `matter(fs.readFileSync(file, "utf8"))`
with no `try`/`catch` at all:

```
const { data } = matter(fs.readFileSync(file, "utf8"));
```

Confirmed directly that a malformed `route:` block throws out of this call:

```
node -e '
const matter = require("gray-matter");
const raw = "---\nroute: [unterminated\n---\n\nx\n";
try { matter(raw); } catch (e) { console.log("threw:", e.message.split("\n")[0]); }
'
threw: unexpected end of the stream within a flow collection at line 3, column 1:
```

`getPlan` (lib/plan.ts:56), which calls `readPlanFile`, is called directly
from page components with no try/catch around it either —
`app/[user]/trips/[trip]/page.tsx:75` and
`app/[user]/(trip)/map/page.tsx:83` (also `app/[user]/trips/[trip]/map/page.tsx`
and `lib/photobook/source.ts:244`). So a `plan.md` that fails to parse does not
degrade like a malformed `trip.md` or a malformed day entry (both return a
reported failure and let the rest of the page render, per B83 and B236) — it
throws uncaught during render and takes down the whole trip page and the map
page, for every visitor, until the file is fixed. A single frontmatter typo in
an optional file (`plan.md` is documented as optional in AGENTS.md) currently
has a larger blast radius than the same typo in the trip's own required
`trip.md`.

This is a distinct bug from B312: B312 is gray-matter's cache silently
un-reporting a failure that *was* caught; this is `lib/plan.ts` never catching
the failure in the first place. Filed separately rather than folded into B312,
per this repo's convention of one capture per problem.

## Work

- Wrap the `matter()` call in `readPlanFile` (lib/plan.ts:69) in a
  `try`/`catch`, matching the shape of `readTrip`'s catch in lib/trips.ts and
  the entries guards in lib/entries.ts / lib/api/entries.ts: log a `[plan]`
  warning with the first line of the parse error, clear gray-matter's cache
  (same reasoning as B236 and B312 — a caught-but-unchanged file must not
  silently succeed on a later re-parse), and return no stops rather than
  throwing.
- `getPlan` already warns and continues when a parsed `route:` is unusable
  (the `raw.length === 0` branch) — the fix should produce that same
  "no usable route" outcome for an unparseable file, not a new third shape.
- Decide whether `readTrip`'s doc comment (lib/trips.ts, "One trip.md → a Trip,
  or a MalformedTrip...") should stop citing `lib/plan.ts` as prior art for
  "matching", since until this is fixed it is not accurate.

## Acceptance

- A test (model on `test/malformed-trips.test.ts` / `test/malformed-entries.test.ts`
  for the temp-CONTENT_DIR fixture shape): a trip with a `plan.md` whose
  frontmatter does not parse — `getPlan(tripId)` does not throw, and returns
  an empty stop list (or whatever "no usable route" already returns) rather
  than propagating the parse error.
- `npm run verify` passes.
