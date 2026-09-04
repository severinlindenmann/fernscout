---
id: B165
title: Turning the costs capability off leaves the costs pages fully rendered
type: ISSUE
priority: medium
complexity: low
area: costs, capabilities
found: "2026-09-03"
started: "2026-09-04T05:58:32Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:32Z"
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
