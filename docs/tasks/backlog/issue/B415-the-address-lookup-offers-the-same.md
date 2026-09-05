---
id: B415
title: The address lookup offers the same address twice when OSM holds a building and a shop at it
type: ISSUE
priority: low
complexity: low
area: contacts, address lookup
found: "2026-09-05T10:20:00Z"
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
