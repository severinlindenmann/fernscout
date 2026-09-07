---
id: B765
title: The trip masthead shows the journal's name and tagline instead of the trip's
type: ISSUE
priority: medium
complexity: low
area: trip hero, reading
found: "2026-09-07T14:01:29Z"
completed: "2026-09-07T14:04:51Z"
---

# B765 — The trip masthead shows the journal's name and tagline instead of the trip's

## Why

`components/TripHero.tsx:110` read

```ts
const heading = active.isCurrent ? site.title : localized.title;
const subheading = active.isCurrent ? site.tagline : (localized.tagline ?? site.tagline);
```

so on the bare journal URL the masthead was the **journal's** title and
tagline, not the trip's. Reported from `/severin`, where the hero read
"Viki + Sevi's Reisen" over an emoji tagline, above a card saying the trip was
over — and nowhere on the card was the name of the journey it belonged to.

The original reasoning was that a bare URL is the journal's front door. Two
things are wrong with it:

- **`PageHeader` already renders `site.title`** (`components/PageHeader.tsx:128`),
  directly above this. So the hero spent its largest line repeating what was
  already on screen, while the one fact a reader wants from it — *which
  journey is this* — was missing.
- **`isCurrent` only means the most recent trip**, not one still happening.
  A finished journey therefore sat under the journal's name next to its own
  "the trip is over" card, which reads as a mistake because it is one.

The date line under the heading has always been the trip's, so the heading was
also disagreeing with what sat immediately beneath it.

## Work

Drop the conditional: the masthead is always the trip. A trip with no tagline
of its own still falls back to the journal's, so the line keeps its shape.

## Acceptance

- The hero on a journal's bare URL shows the current trip's title, not the
  journal's.
- A trip with no tagline still shows a subheading.
- The journal's own name is still on the page, from `PageHeader`.
