---
id: B313
title: getPlan's own doc comment claims a malformed plan.md returns empty, but readPlanFile has no guard and throws
type: ISSUE
priority: medium
complexity: low
area: plan, reading
found: "2026-09-04T16:22:43Z"
started: "2026-09-04T19:26:10Z"
merged: "2026-09-04T19:34:15Z"
---

# B313 — getPlan's own doc comment claims a malformed plan.md returns empty, but readPlanFile has no guard and throws

## Why

Found while building B236 (the equivalent fix for `lib/entries.ts`), while
checking the rest of the codebase for the same unguarded-`matter()` shape.

`getPlan`'s doc comment (`lib/plan.ts:29`) says:

> Returns an empty plan when content/plan.md is absent or malformed rather
> than throwing — the plan is a nice-to-have layer on the map, and a typo in
> it shouldn't take the map down.

The "absent" half is true — `getPlan` checks `fs.existsSync(file)` first. The
"malformed" half is not: `readPlanFile` (`lib/plan.ts:61`) calls
`matter(fs.readFileSync(file, "utf8"))` with no `try`/`catch` at all. A
`plan.md` whose frontmatter does not parse — the exact failure B236 is about,
just in a different file — throws straight out of `getPlan`, contradicting
what the comment two lines above the call promises.

This is not a hypothetical: `getPlan` is called from the trip page itself
(`app/[user]/trips/[trip]/page.tsx:74`), both map pages
(`app/[user]/trips/[trip]/map/page.tsx:60`,
`app/[user]/(trip)/map/page.tsx:79`), and the photobook source
(`lib/photobook/source.ts:244`). A typo in `plan.md` does not merely fail to
draw a route — on current code it takes the trip page down with it, which is
worse than "the map is missing" and exactly the failure the comment says was
already ruled out.

## Work

- Guard `readPlanFile`'s `matter()` call the same way `readAllEntries` now
  does (lib/entries.ts, B236): `try`/`catch`, log with `console.warn`, return
  no stops rather than throwing. Also call `clearMatterCache()`
  (`lib/entries.ts`) in the catch — see B312 for why that call matters and is
  not optional.
- Leave the "no usable `route:` list" warning already in `readPlanFile`
  unchanged; this is the parse-level failure above it, not a replacement for
  it.

## Acceptance

- A test: write a `plan.md` whose frontmatter does not parse, assert
  `getPlan` returns `{ stops: [], reachedCount: 0, next: undefined }` rather
  than throwing, and that a warning was logged.
- `npm run verify` passes.

## Done

Fixed as specified: `readPlanFile` (`lib/plan.ts`) now wraps the `matter()`
call in `try`/`catch`, calls `clearMatterCache()` and `console.warn`s with the
file path and gray-matter's first error line, then returns `[]` — same shape
as `readAllEntries` (B236). The existing "no usable `route:` list" warning
below it is untouched; it only fires once parsing has already succeeded, so
the two never both fire for the same file.

New test `test/malformed-plan.test.ts`, following the naming and shape of
`test/malformed-entries.test.ts` / `test/malformed-trips.test.ts`: a
`plan.md` with unterminated YAML now reads as `{ stops: [], reachedCount: 0,
next: undefined }` with a warning logged, a good `plan.md` is unaffected, and
fixing the file clears the failure without a restart (the cache-clearing
check B312 cares about). Confirmed the new test throws
(`YAMLException: unexpected end of the stream...`) against the pre-fix
`readPlanFile` and passes against the fix.

`npm run verify` passes (build, tsc, eslint, 179 test files / 2629 tests).

While checking the rest of the codebase for the same shape, found a second,
separate instance in `lib/costs.ts`'s `readCostsFile` — wider blast radius
than this one, since it also gates the nav's Costs tab across every page of a
journal. Captured separately as B342 rather than absorbed here.
