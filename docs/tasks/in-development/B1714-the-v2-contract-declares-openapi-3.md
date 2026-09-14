---
id: B1714
title: The v2 contract declares OpenAPI 3.1.0 and emits request where the specification says requestBody, so no standard tool sees a body on any write
type: ISSUE
priority: high
complexity: low
area: api v2, contract
found: "2026-09-14T09:23:00Z"
started: "2026-09-14T09:58:17Z"
session: 3309c078-d934-4ee7-ad04-6cd719fc543a
claimed: "2026-09-14T09:58:17Z"
---

# B1714 — The v2 contract declares OpenAPI 3.1.0 and emits `request` where the specification says `requestBody`

## Why

Live, today:

```
$ curl -s https://fernscout.ch/api/v2/openapi.json | jq '.openapi, .info.version'
"3.1.0"
2
$ ... | jq '.paths["/api/v2/{user}/trips/{trip}/days/{slug}"].put | keys'
["request", "responses", "summary"]
```

OpenAPI 3.1 names that key `requestBody`. `request` is not in the
specification, so every generator, validator and client library reads that
operation as taking no body at all — on `PUT` and `PATCH` for a day, a trip and
a journal, on every media, publish, send, costs, figure, purchase and contact
door: roughly two dozen operations in `lib/api/v2/openapi.ts`, each built by
the same `jsonBody(...)` helper assigned to `request:`.

The document announces itself as 3.1.0, so a caller has no reason to suspect a
house-private key. It is the same failure class as a route that answers 404:
the contract tells a client something that is not true, and the client believes
it. An agent migrating a real journal on 2026-09-14 hit exactly this — reached
for `requestBody`, read `undefined`, and had to write every call by hand.

`request:` also carries the declinables list (`TRIP_DECLINABLES`,
`DAY_DECLINABLES`), which is Fernscout's own vocabulary and has nowhere
standard to go. That part is a real extension and belongs under `x-` rather
than displacing a specified key.

## Work

- Emit `requestBody` where the helper currently emits `request`.
- Keep whatever cannot be expressed in 3.1 as an `x-`-prefixed key beside it —
  `x-declinable`, or inside the schema — never as a bare word the specification
  has already claimed.
- Pin it: a test that every operation object in the generated document has only
  keys 3.1 allows, so the next extension lands as `x-` by force rather than by
  memory.
- Check `/openapi.json` (the surviving v1/auth document, `lib/api/openapi.ts`)
  for the same shape while in there.

## Acceptance

- `curl -s https://fernscout.ch/api/v2/openapi.json` validates against
  OpenAPI 3.1 with an off-the-shelf validator.
- Every write operation reports a body through that validator.
- A test fails if a non-`x-` key outside the specification appears on an
  operation.
