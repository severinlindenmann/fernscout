---
id: B304
title: A day's costs still accept a zero amount and an unrecognised currency, and drop both silently
type: ISSUE
priority: medium
complexity: low
area: api, costs, validation
found: "2026-09-04T14:41:15Z"
started: "2026-09-04T16:07:51Z"
session: 46daaba3-3210-4263-85a6-d285caefd837
claimed: "2026-09-04T16:07:51Z"
---

# B304 — A day's costs still accept a zero amount and an unrecognised currency, and drop both silently

## Why

Found while building B295, whose ticket flagged exactly this failure one field
over and excluded the per-day path from its scope.

B295 built `lib/validate/costs.ts` for the trip budget door and made it refuse
what the parsers would otherwise discard in silence: a zero or missing total, a
zero or negative amount, an unrecognisable currency. The reason is B263's — a
write that is accepted, reports success, and stores nothing lets an agent tell
its owner the money is recorded when it is not.

The per-day costs path did not get that treatment. `checkCosts` in
`lib/validate/entry.ts` — which `POST .../days` and `PATCH .../days/<slug>`
both use — checks the category and does **not** check the currency's shape or
reject a zero or negative amount. So a day written with
`{"label": "Ferry", "amount": 0, "currency": "Euros"}` is accepted, and what
reaches the page is a cost item missing its amount, or its currency, or both,
with nothing said to anybody.

Same failure, same fix, one file over. It is separate only because B295's
ticket drew its scope at the trip budget and B295's agent respected that rather
than widening it unasked.

## Work

Extend `checkCosts` to make the two checks `lib/validate/costs.ts` already
makes, and reuse that module rather than writing a third opinion about what a
cost item is — B295 already had to export `checkCosts` and `describe` from
`lib/validate/entry.ts` for the same reason, so the two files are already
acquainted.

Check what an existing hand-written entry with a sloppy cost does before
tightening: a day already on disk with a zero amount must not start failing to
render. This refuses new *writes* through the door; it must not turn a file
somebody already has into an error page. That distinction is the whole risk in
this task.

## Acceptance

- `POST .../days` and `PATCH .../days/<slug>` refuse a zero or negative cost
  amount and an unrecognisable currency, naming the field.
- An entry already on disk carrying either still renders.
- The messages match the trip-budget door's, since it is the same mistake.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
