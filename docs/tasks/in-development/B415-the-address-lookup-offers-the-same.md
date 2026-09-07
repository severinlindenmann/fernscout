---
id: B415
title: The address lookup offers the same address twice when OSM holds a building and a shop at it
type: ISSUE
priority: low
complexity: low
area: contacts, address lookup
found: "2026-09-05T10:20:00Z"
started: "2026-09-07T10:37:35Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T10:37:35Z"
---

# B415 — The address lookup offers the same address twice when OSM holds a building and a shop at it

## Why

Seen on the live site the moment the capability was switched on (B399):

```
GET /api/address-lookup?user=example&q=Bahnhofstrasse%2012%20Zurich
{"results":[
  {"line1":"Bahnhofstrasse 12","postcode":"8001","city":"Zurich","country":"CH"},
  {"line1":"Bahnhofstrasse 12","postcode":"8001","city":"Zurich","country":"CH"},
  {"line1":"Bahnhofstrasse 12","postcode":"8712","city":"Stäfa","country":"CH"},
  …
```

The first two rows are identical in every field the form will use. Upstream
they are not the same object — Photon returns one for the apartment building
(`osm_key: building`) and one for the shop inside it (`osm_key: shop`, name
"Versace") — but B399 maps a result down to line1/postcode/city/country, and
at that point the distinction is gone.

The cost is small and entirely about trust: a picker offering the same answer
twice reads as broken, and the person has to look twice to satisfy themselves
the rows really are identical. It also spends two of the capped result slots
on one address, which pushes genuinely different places off the list.

## Work

Deduplicate on the four fields the result actually carries, keeping the first
occurrence, after mapping and before the cap is applied — so the cap counts
distinct addresses.

Not doing: showing the OSM name ("Versace") to tell them apart. That is a
business at the address, not the address, and the form has nowhere to put it.

## Acceptance

The query above returns Bahnhofstrasse 12, 8001 Zurich once. A test with a
stubbed provider returning two features that differ only in `osm_key` gets one
result back.

## Triage

Confirmed against current code: `lookupAddresses` (`lib/addressLookup.ts`)
mapped every `type: "house"` feature straight into `out` with no dedup. There
is no separate post-mapping "cap" in the code as written — `MAX_RESULTS` (8)
is sent to the provider as the `limit` query param (line ~100), not applied
locally after mapping — so "before the cap" reduces to "while building
`out`". Fixed with a `Set<string>` keyed on `line1|postcode|city|country`,
skipping a feature whose key was already seen, keeping the first occurrence
(the building, ahead of the shop, matching the live example in the Why
section).

Test: added to `test/address-lookup.test.ts` — two stubbed features
differing only in `osm_key`/`name` (Photon's own distinguishing fields, which
the mapped shape drops) collapse to one result.
