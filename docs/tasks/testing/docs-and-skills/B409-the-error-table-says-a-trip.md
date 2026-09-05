---
id: B409
title: The error table says a trip-scoped token gets out_of_scope for another trip, and it gets unknown_trip
type: DOCS
priority: low
complexity: low
area: agent guide
found: "2026-09-05T07:49:40Z"
started: "2026-09-05T08:49:32Z"
merged: "2026-09-05T09:08:36Z"
---

# B409 — The error table says a trip-scoped token gets out_of_scope for another trip, and it gets unknown_trip

## Why

`agent.md`'s error table says:

> `403` | `out_of_scope` | The token is valid but belongs to a different
> journal, **or is scoped to one trip and you asked about another.**

The second half is not what happens. Measured on fernscout.ch 2026-09-05 with a
token scoped to `xydhd-lifecycle/balkans-2026`:

```
GET /api/v1/xydhd-lifecycle/trips/japan-2027/days   -> 404 {"error":"unknown_trip"}
GET /api/v1/xydhd-quiet/trips/kept-back-2026/days   -> 403 {"error":"out_of_scope"}
```

A different *journal* is `403 out_of_scope`, exactly as documented. A different
*trip in its own journal* is `404 unknown_trip` — deliberately, since every
other trip answers as if it did not exist, which is the non-disclosure the
scoping is for.

So the table conflates two cases with different answers, and an agent reading it
would look for a 403 that never comes and might report a scope violation the
server does not signal that way.

## Work

Split the row. Say that a trip-scoped token sees every other trip in its own
journal as `404 unknown_trip`, and why — the trip is not disclosed to a token
that may not read it — and keep `403 out_of_scope` for the wrong journal and
for calls above the token's authority.

## Acceptance

The error table's account of a trip-scoped token matches what the server
returns for both cases.
