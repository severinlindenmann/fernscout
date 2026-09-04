---
id: B165
title: Turning the costs capability off leaves the costs pages fully rendered
type: ISSUE
priority: medium
complexity: low
area: costs, capabilities
found: "2026-09-03"
started: "2026-09-04T05:58:32Z"
merged: "2026-09-04T06:20:33Z"
---

# B165 — Turning the costs capability off leaves the costs pages fully rendered

## Why

`costs` is a capability in every place that describes one. It is in
`FEATURE_NAMES` (`lib/config.ts:10`), it has a requirement row in
`REQUIREMENTS` (`lib/capabilities.ts:18`), a journal declares it in its own
`config.json`, and `/api/health` reports it. AGENTS.md says an optional
capability must be *absent* rather than broken when it is off.

Nothing reads it on the way to a costs page. The only `isEnabled("costs", …)`
call in the codebase is `lib/photobook/source.ts:51`, which keeps the money
spread out of a printed book. Neither `app/[user]/(trip)/costs/page.tsx` nor
`app/[user]/trips/[trip]/costs/page.tsx` asks, and `components/SiteNav.tsx:15`
lists the tab unconditionally.

Measured on a dev server while working on B19: with
`"costs": { "enabled": false }` in `content/config.json` — `/api/health`
agreeing, `{"enabled": false, "reason": "not enabled on this server"}` —
`/example/costs` and `/example/trips/japan-2027/costs` both answered `200`
with the full budget panel, the totals and the itemised table, and the "Costs"
tab was still in the nav.

So an operator who switches spending off gets no change at all. That is worse
than the switch not existing: `/api/health` says the capability is off, which
is a claim about the running site that the running site contradicts. The same
is true per journal — a user's `config.json` may narrow what the instance
allows, and this narrowing does nothing.

Note that `costsVisibility` is a *different* question and works correctly
(`mayViewCosts`, `lib/tripGate.ts:104`): that is who among readers may see the
numbers, not whether this instance does spending at all.

## What was built

The Why is accurate and the measurement in it reproduces. Nothing needed
correcting.

**The decision: `notFound()`, a 404, for both costs pages.** Three reasons, and
the third is the one that settles it.

1. It is what every other capability-gated route in this codebase already does
   — `app/[user]/contacts/page.tsx`, `app/[user]/i/[token]/page.tsx` — so a
   reader who meets one has met the shape before.
2. AGENTS.md asks for *absent rather than broken*, and the alternatives are
   both "broken": an empty budget panel is a page that says the trip cost
   nothing, and a "spending is switched off on this site" notice is an
   operator's configuration explained to a reader who never asked and cannot
   act on it.
3. The capability is **journal-wide and reader-independent**, so a 404 leaks
   nothing. That is what makes it different from `costsVisibility`, where a 404
   would tell a stranger that the trip has costs they are not allowed to see —
   which is why that axis renders `CostsPrivate` and this one does not. The two
   look like the same decision and are not.

The changes:

- **`mayViewCosts` asks first** (`lib/tripGate.ts`). It is already "the one
  call every costs-rendering path makes", so the story feed's per-day badge,
  the spend block, `story.json` and the day pages all follow from the same
  answer. Both neighbours the Work section named — `costForDay` and the spend
  block in `buildStoryProps` — reach it through `showCosts`, which is this
  return value, so neither needed its own gate.
- **Both costs pages `notFound()`**, in the page rather than the layout, for
  the reason `lib/tripGate.ts` gives about the RSC payload and the head.
  `generateMetadata` returns `{}` on both, so nothing describes a page that is
  not there, and `generateStaticParams` on the per-trip page prerenders none.
- **`SiteNav` drops the tab.** `SiteSummary` gains `costsEnabled`, resolved by
  `isEnabled("costs", username)` next to `canSignIn` and for the same reason —
  it is a property of the journal, so every caller would otherwise compute it
  and one would forget.
- **`app/sitemap.ts` stops offering `/costs`** for a journal with it off. A
  sitemap entry pointing at a 404 is the same bug as a nav tab pointing at one.
- `TripSwitcher` needed nothing: its `pageSuffix` only preserves the kind of
  page you are already on, and with costs off you are never on one.

## Work

- Decide, and write down, what "off" means for the costs pages: `notFound()`
  is what every other capability-gated route does (`app/[user]/contacts/page.tsx:34`,
  `app/[user]/i/[token]/page.tsx:44`), and it is probably right here too.
- Gate both costs routes on `isEnabled("costs", user)`, in the page rather
  than the layout — the reason is in `lib/tripGate.ts`: a layout gate leaks
  the page's data into the RSC payload and the head even when it renders
  something else.
- Drop the "Costs" tab from `SiteNav` when it is off, so nothing links at a
  404.
- Check the neighbours while there: the per-day cost badge in the story feed
  (`costForDay`) and the spend block in `buildStoryProps` (`lib/tripView.ts:157`)
  are the same numbers by another route.

Not doing: anything about `costsVisibility`, which is a separate and working
mechanism.

## Acceptance

- With `costs` disabled at the instance, `/<user>/costs` and
  `/<user>/trips/<trip>/costs` answer 404 and the nav has no Costs tab.
- With it disabled for one journal only, that journal's pages are gone and
  another journal's are not.
- The story feed shows no spending figures with it off.
- A test covers on and off; `npx vitest run` and `npm run build`.

### Evidence

Every line has a test that fails with the gates removed — demonstrated by
disabling all four and re-running: eight failures, all green with them back.

- `test/costs-capability.test.ts` — both pages throw `notFound` with `costs`
  off and render with it on; `generateMetadata` returns `{}` on both;
  `generateStaticParams` offers the trip's costs page with it on and nothing
  with it off.
- Same file → "off for one journal is on for the next": `isEnabled` is asked
  with the username and the answer is per journal.
- `test/costs-off.test.ts` — driven from a real `config.json` rather than a
  mocked `isEnabled`, because the wiring between the two is what was broken.
  `mayViewCosts` on a `public` trip with `costsVisibility: public` — a trip
  nothing else hides — is true with the capability on and false with it off, at
  the instance and per journal. That is the story feed's `showCosts`, so it is
  the "no spending figures" line.
- Same file → "health and the site give the same answer": `resolveCapabilities`
  and `mayViewCosts` are asserted equal, which is the claim `/api/health` was
  making and the site was contradicting.
- `test/site-nav.test.tsx` → "the costs tab follows the capability": the
  rendered nav has no `/alex/costs` href with it off, and the other four
  entries are untouched.
- `npx tsc --noEmit`, `npx eslint .` (0 errors), `npx vitest run` (117 files,
  1912 passed, 2 skipped) and `npm run build` all pass.
