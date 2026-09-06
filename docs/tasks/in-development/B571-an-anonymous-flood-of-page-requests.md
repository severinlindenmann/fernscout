---
id: B571
title: an anonymous flood of page requests writes unbounded analytics rows
type: ISSUE
priority: medium
complexity: low
area: analytics, ops
found: "2026-09-06T15:55:00Z"
started: "2026-09-06T14:03:25Z"
session: c2cdeefe-2d73-48d5-9f28-14caaaab1378
claimed: "2026-09-06T14:03:25Z"
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

Two related things were captured with this as "the numbers can be wrong
rather than the disk being full". **One of them was mistaken**, and finding
that out is what decided the fix:

- **`clientIp` trusting `X-Forwarded-For` is not exploitable on this
  deployment.** The capture said somebody rotating the header could inflate
  unique-visitor counts freely. `deploy/fernscout.caddy:56` sets
  `header_up X-Forwarded-For {remote_host}`, which *overwrites* whatever the
  client sent rather than appending to it — so the value `clientIp` reads is
  the proxy's observation and not the caller's choice. That is also what makes
  a per-address bound worth building here rather than trivially bypassable,
  and it is why the fix below is keyed on the address. The property belongs to
  the Caddyfile, not to the application: behind a proxy that appends, this
  bound is forgeable and so is every rate limit in the codebase, which
  `lib/rateLimit.ts` already says at length. No separate capture; the risk is
  the existing, documented one.
- **The per-process salt is still a real latent issue**, unchanged by this
  ticket. Two server processes would each hold their own daily salt, so one
  reader hashes differently per process and uniques inflate. Today's deploy is
  a single Node process. It becomes live the day anybody puts a second worker
  behind the proxy — and so does the bound below, which is one in-memory map
  per process. Left as a note here rather than captured separately, because
  the two have the same trigger and the same answer (shared state), and one
  ticket about "this is single-process" is better than two.

## Work

**A per-address write budget on the recording path**, and nothing else.

`rateLimitFor("analytics-view", ip, VIEW_BUDGET)` in `recordView`
(`lib/analytics/record.ts`), reusing the limiter that already exists rather
than inventing a second bucket. Over the budget, the view is **dropped
silently** — the reader still gets their page, only the counting stops. A 429
would let one stranger's loop decide who may read a family's journal, which is
backwards; a counter that misses part of a flood is correct, because a flood is
not readership.

**The check goes last, after the bot, prefetch and owner checks.** That makes
the budget a budget of rows *written* rather than requests *received*: an owner
reading their own journal all afternoon, and every crawler that visits, cost
nothing, so neither can exhaust the allowance their family's real visits are
then counted against. `test/analytics-budget.test.ts` asserts exactly that.

`VIEW_BUDGET` is 300 views per address per hour, exported from
`lib/analytics/record.ts` so the number has one home and the test can assert
the ceiling rather than restate it. It is set from what a *household* can
honestly read, not one person: everybody behind one home connection or one
hostel wifi shares an address, and they are the group most likely to read the
same journal on the same evening. Four people through a forty-day trip is 172;
a script does 300 in under a second. The number lives in that gap, and it is
deliberately generous — a budget set too low turns a family's real reading into
a flat line and the owner draws the wrong conclusion from it, which is a worse
failure than an over-generous bound on disk.

**The per-journal-per-day row ceiling was considered and not built.** It bounds
the table by construction, which the per-address budget does not, but it costs
a query on every page render to defend against a distributed flood that would
already be taking the site down through CPU — and rate-limiting page renders in
general is explicitly out of scope below. It is written up as the upgrade path
in a `ponytail:` comment on the check itself, so the next person meets it where
the decision was made.

Explicitly **not** in scope: rate-limiting page requests in general. That is a
much larger decision about the whole site and it needs its own ticket.

## Acceptance

All three demonstrated.

- **A loop of a few thousand anonymous requests leaves a bounded number of
  rows, and the site still renders.** 2000 requests to `/example` against a
  local server, one address, browser user agent: **2000 × HTTP 200, 0 non-200,
  300 rows, 1 distinct visitor**, and `/example` and `/example/gallery` both
  still answered 200 afterwards. Before the change the same loop leaves 2000
  rows.
- **Ordinary reading is unaffected.** `test/analytics-budget.test.ts` — ten day
  opens are ten rows, and a household's evening (four readers × a forty-three
  page trip = 172) is 172 rows, asserted to be under `VIEW_BUDGET.max` so that
  tightening the number without thinking about shared addresses fails the
  suite.
- **A test pins the ceiling.** Same file, six tests. Verified by mutation
  rather than assumed: with the `rateLimitFor` line commented out, "a thousand
  requests leave at most the budget" fails with `expected 1000 to be 300`, and
  passes with it. The other five guard the directions that would still be
  wrong if the bound were built carelessly — a flood must be dropped and never
  refused, one address being throttled must not silence another, and bots and
  prefetches must cost no budget at all.

`npm run verify` green: 283 files, 3676 passed, 3 skipped.
