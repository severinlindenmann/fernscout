---
id: B1709
title: Analytics on a trip with nothing measured says the trip was taken down
type: ISSUE
priority: medium
complexity: low
area: analytics, navigation
found: "2026-09-14T09:00:00Z"
started: "2026-09-14T08:40:42Z"
merged: "2026-09-14T08:47:44Z"
completed: "2026-09-14T16:32:55Z"
---

# B1709 — Analytics on a trip with nothing measured says the trip was taken down

## Why

Reported on fernscout.ch: open a trip that has no costs and no weather, click
**Analytics**, and the answer is *"That trip isn't here any more. It was taken
down or renamed."* The trip is there. The reader is on it.

Two halves:

- The tab is offered journal-wide. `SiteNav` hides it on `!site.analyticsEnabled`,
  and `analyticsAvailable()` (`lib/analytics.ts`) asks whether **any** trip in
  the journal has costs or weather. The nav has no per-trip answer to give.
- The hub answers per trip: `analyticsCardsFor()` empty → `notFound()`
  (`app/[user]/(trip)/analytics/page.tsx`, `app/[user]/trips/[trip]/analytics/page.tsx`),
  and the nearest not-found page is the journal's, whose copy is about a trip
  that was deleted or renamed. So a working link produces a message that is
  false twice over.

## Work

Stop the hub 404ing for a trip the reader may read. Render it with no cards and
one sentence saying nothing has been measured on this trip yet — the honest
answer, and the one that keeps the tab from lying. The 404 stays for a trip
that does not exist or that this reader may not read.

New string in `site/locales/` (en, de, hu) plus `npm run i18n:keys`.

Not done here: per-trip gating of the nav tab, which would need the flag
threaded through `TripProvider` from every trip page. Worth a separate ticket
if the empty hub proves annoying rather than merely quiet.

## Acceptance

- A readable trip with no costs and no weather shows the Analytics hub with
  the empty sentence, HTTP 200 — never the trip-not-found page.
- A trip with either card is unchanged.
- An unknown trip id still 404s.
- `npm run verify` green; checked in a browser at 390 and 1280.
