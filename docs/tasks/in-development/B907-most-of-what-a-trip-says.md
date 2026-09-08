---
id: B907
title: Most of what a trip says about itself can be written once and never corrected
type: ISSUE
priority: medium
complexity: low
area: api, trips
found: "2026-09-08T04:57:40Z"
started: "2026-09-08T19:51:08Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:51:08Z"
---

# B907 — Most of what a trip says about itself can be written once and never corrected

## Why

`POST /api/v1/<user>/trips` accepts seventeen fields. `PATCH` accepts five —
`title`, `tagline`, `start`, `end`, `cover`.

Written once and never correctable: **`intro`** (the trip's own prose),
`accent`, `status`, `listed`, `teaser`, `costsVisibility`, `test`.

So a typo in a trip's introduction is permanent unless somebody has a shell on
the server, and a trip created with `listed: true` by mistake cannot be
un-advertised through the API. This is the same class as B220 and the same
class as the currency in B839: create validates and accepts, correct cannot
reach.

Found by mapping every operation to a chat shape, 2026-09-08.

## Work

Widen `PATCH` to the fields that are safe to change after the fact. Some
deliberately are not — `test` on a trip that has published days is a different
question, and `status` may want its own route the way a day's does (B905).
Decide each rather than widening wholesale, and write the reasoning where the
next person will find it.

`listed` has a rule already: `listed: true` on a trip nothing advertises is
refused and logged (B51). Whatever `PATCH` accepts must keep that.

## Acceptance

A trip's intro can be corrected over the API, and each field that still cannot
be says why in the document.
