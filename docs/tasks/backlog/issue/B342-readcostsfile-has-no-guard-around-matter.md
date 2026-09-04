---
id: B342
title: readCostsFile has no guard around matter() and throws on a malformed costs.md
type: ISSUE
priority: medium
complexity: low
area: costs, reading
found: "2026-09-04T19:31:04Z"
---

# B342 — readCostsFile has no guard around matter() and throws on a malformed costs.md

## Why

Found while building B313 (the same unguarded-`matter()` shape in
`lib/plan.ts`), while checking the rest of the codebase for other callers of
this pattern.

`readCostsFile` (`lib/costs.ts:67-68`) calls
`matter(fs.readFileSync(file, "utf8"))` with no `try`/`catch`. Unlike
`getPlan`, nothing here claims malformed input is handled gracefully — but the
blast radius is arguably wider than B313's: `readCostsFile` backs
`hasCostsData`, which backs `journalHasCosts` and `costsAvailable`
(`lib/costs.ts:105-118`), which decides whether the **nav** shows a Costs tab
on every page of a journal, not just the costs page. It also backs
`getPreparationCosts` and `getBudget`, called from the trip page itself
(`app/[user]/trips/[trip]/page.tsx`), both costs pages
(`app/[user]/trips/[trip]/costs/page.tsx`,
`app/[user]/(trip)/costs/page.tsx`), the costs API route
(`app/api/v1/[user]/trips/[trip]/costs/route.ts`), and `app/sitemap.ts`.

A `costs.md` whose frontmatter does not parse — a stray `[` an agent or a
person left behind — throws straight out of `readCostsFile` and takes down
every one of those with it, including the sitemap for the whole journal.

## Work

- Guard `readCostsFile`'s `matter()` call the same way `readAllEntries`
  (`lib/entries.ts`, B236) and `readPlanFile` (`lib/plan.ts`, B313) now do:
  `try`/`catch`, `console.warn`, return `null` (this function's existing
  "no file" value) rather than throwing. Call `clearMatterCache()`
  (`lib/entries.ts`) in the catch — see B312 for why that call is not
  optional.
- Every caller in `lib/costs.ts` already treats `readCostsFile(...) === null`
  as "no costs.md" (`hasCostsData`, `getPreparationCosts`, `getBudget`), so
  returning `null` on a parse failure should require no changes below
  `readCostsFile` itself — worth confirming while building this, not assuming.
- Consider whether `readCostsFile`'s doc comment should say what B313 found
  missing from `getPlan`'s: that malformed input is handled, not just absent
  input.

## Acceptance

- A test: write a `costs.md` whose frontmatter does not parse, assert
  `readCostsFile` returns `null` rather than throwing, that `hasCostsData`
  and `costsAvailable` do not throw either, and that a warning was logged.
- `npm run verify` passes.
