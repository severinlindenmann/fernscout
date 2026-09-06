---
id: B571
title: an anonymous flood of page requests writes unbounded analytics rows
type: ISSUE
priority: medium
complexity: low
area: analytics, ops
found: "2026-09-06T15:55:00Z"
---

# B571 — an anonymous flood of page requests writes unbounded analytics rows

## Why

Found while reviewing B566 before merge, and captured rather than absorbed.

Since B566 every open of `/<user>`, a day, the gallery or the map writes one
row to `analytics_events` — and **page renders are not rate-limited**.
`lib/rateLimit.ts` is called from routes under `app/api/` only; nothing guards
a page request, because until now a page request cost CPU and no storage.

So an unauthenticated stranger looping `GET /example` writes one row per
request, for as long as they care to. `RETENTION_DAYS` caps the age of the
damage at ninety days, not its rate: a few hours of a scripted loop is millions
of rows, on a single VPS with one disk, and the journal it fills up is
everybody's on the instance because it is one table and one database.

It is not a data-disclosure bug — the rows are the same anonymous counts as
ever, and nothing about a reader is stored (`lib/analytics/visitor.ts`). It is
availability: the disk fills, and Postgres on a full disk takes the whole site
with it, not merely the counter.

Two related things worth deciding at the same time, both about the numbers
being *wrong* rather than the disk being full:

- `clientIp` trusts `X-Forwarded-For` (documented at length in
  `lib/rateLimit.ts`, and correct behind this Caddy). Somebody rotating the
  header inflates unique-visitor counts freely. Nothing above the counter
  depends on it, but a page that reports "412 people" should not be trivially
  forgeable by one.
- Multiple server processes would each hold their own daily salt, so the same
  reader hashes differently per process and uniques inflate. Today's deploy is
  a single Node process, so this is latent rather than live — but it becomes
  live the day anybody puts a second worker behind the proxy.

## Work

Not decided; the cheapest thing that holds is probably enough:

- A per-IP write budget on the recording path — reuse `lib/rateLimit.ts`
  rather than inventing a second bucket, e.g. at most N rows per IP per
  minute, dropping silently past that. Dropping is correct here: a counter
  that misses some of a flood is right, and a flood is not readership.
- Or a per-journal-per-day row ceiling checked before the insert, which is one
  more query per view and bounds the table by construction.
- Consider whether the two "wrong numbers" items above are this task or their
  own captures.

Explicitly **not** in scope: rate-limiting page requests in general. That is a
much larger decision about the whole site and it needs its own ticket.

## Acceptance

- A loop of a few thousand anonymous requests to `/<user>` leaves a bounded
  number of rows in `analytics_events`, and the site still renders.
- Ordinary reading is unaffected: a person opening ten days in a row is ten
  rows.
- A test that pins the ceiling, whichever mechanism is chosen.
