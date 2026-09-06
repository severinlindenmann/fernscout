---
id: B566
title: the owner cannot tell whether anyone is reading the journal
type: FEATURE
priority: medium
complexity: high
area: analytics, privacy
found: "2026-09-06T11:04:40Z"
started: "2026-09-06T13:29:28Z"
session: c2cdeefe-2d73-48d5-9f28-14caaaab1378
claimed: "2026-09-06T13:29:28Z"
---

# B566 — the owner cannot tell whether anyone is reading the journal

## Why

A journal is written for people to read and there is nothing anywhere that says
whether anybody did. The owner sends a guest link to their family and then has
no way to know whether the link was opened, which day was read twice, or
whether the gallery was looked at at all. `features.logging` (B257,
`lib/requestLog.ts`) writes one line per request to `journalctl` — that is an
operator's tool on a server the owner may not have a shell on, it is method +
path + user agent with no aggregation, and it deliberately carries no identity
at all, so it cannot answer "how many people" for any value of people.

The cost of getting this wrong is larger than the feature. `site/legal/en.md`
currently promises, in a section headed **No tracking**, that there is "no
analytics of any kind on this site … no fingerprinting … no cookie banner
because there is nothing to consent to". Shipping anything here makes that
paragraph false until it is rewritten in the same change. A persistent device
fingerprint would additionally be personal data under GDPR — this instance
hosts in a German data centre and reads mostly from the EU and Switzerland —
and would require a consent banner, which is a much bigger feature than the
question being asked. So the design below is constrained by the imprint rather
than the imprint being retrofitted to the design.

Four decisions were taken with the owner before this was written, and the plan
is only valid with all four:

- **The page is `/<user>/me/analytics`**, not `/<user>/analytics`. That URL is
  taken: it is the trip Analytics hub of costs and weather (B557,
  `app/[user]/(trip)/analytics/`), which is an analysis *of the trip* shown to
  readers. This is an analysis *of the readers* shown to the owner, and it
  belongs under `/me`, which is already the owner-and-reader's own area and is
  already `robots: noindex`.
- **The visitor identifier is a daily rotating salted hash**, never a
  persistent fingerprint. Unique-visitors-per-day is answerable; returning
  visitors across days deliberately is not.
- **Owner only.** Not buddies, not trip people, not guests — for now. See
  *Not doing* for why that is a smaller decision than it looks.
- **Recorded server-side, with no client JavaScript.** No beacon route, no new
  public write endpoint, nothing in the browser bundle, nothing an ad-blocker
  changes the answer of.

## Work

### 1. The identifier — `lib/analytics/visitor.ts`

```
visitorHash = sha256(dailySalt + ":" + username + ":" + ip + ":" + userAgent)
```

truncated to 16 hex characters, and that value is the only thing about a
visitor that is ever written down. Never the IP, never the user agent, never a
cookie, never anything read from the browser.

- `dailySalt` is a random 32-byte value generated on first use for a given UTC
  date and **held in memory only**. It is not persisted, so a restart rotates
  it early — which loses some same-day uniqueness and is the safe direction to
  fail in. At the UTC date change the previous salt is dropped and is
  unrecoverable, which is what makes yesterday's hashes permanently
  non-reversible and non-linkable to today's.
- Salting per journal (`username` in the input) stops one journal's numbers
  being cross-referenced against another's on a multi-journal instance.
- `clientIp(req)` already exists in `lib/rateLimit.ts` — reuse it, do not write
  a second header parser. Note it trusts `X-Forwarded-For`; that is a known
  existing property of this deployment and not this ticket's to fix.

This is the Plausible/Matomo method and is the reason the imprint can keep
saying there is no cookie and nothing to consent to. It is deliberately weaker
than a fingerprint: two people on one home connection with the same browser
are one visitor, and the same person tomorrow is a new visitor. Say so on the
page — a number whose limits are printed next to it is a number the owner can
use.

### 2. The table — `analytics_events`, migration `021-analytics`

Follows the schema rules in `lib/db/schema.ts` exactly: text ids generated in
application code, text ISO-8601 UTC timestamps, `owner_id` on every row.

| column | |
| --- | --- |
| `id` | text |
| `owner_id` | text — the journal, as everywhere else |
| `kind` | text — `journal` \| `trip` \| `day` \| `gallery` \| `map` \| `photobook` |
| `trip_id` | text, null for `journal` |
| `slug` | text, null except for `day` |
| `visitor_hash` | text — §1 |
| `occurred_at` | text, ISO-8601 UTC |

Add to `Database` and to `TABLE_NAMES`.

**Retention is part of the feature, not a follow-up.** Rows older than 90 days
are deleted; do it opportunistically on the read path (one `delete` before the
first aggregate of a request) rather than adding a job — there is a `jobs`
table but a sweep that only matters when somebody looks is not worth a worker.
The imprint has to state the 90 days, so the code and the imprint must agree.

### 3. Recording — `recordView()` called from the page

Server-side, from the render of each page that counts, wrapped in
`afterResponse()` (`lib/afterResponse.ts`) so a write never sits on the reader's
critical path and a failure never becomes the reader's error. The pages:

- `app/[user]/page.tsx` → `journal`
- `app/[user]/(trip)/page.tsx` and `app/[user]/trips/[trip]/page.tsx` → `trip`
- `app/[user]/(trip)/day/…` → `day`
- `app/[user]/(trip)/gallery/…` → `gallery` (this is the "gallery watched"
  number; it works because the gallery is its own route, which is the whole
  reason no client beacon is needed)
- `map` and `photobook` for the same reason, if cheap

**Not recorded**, and each of these is a way the numbers lie if forgotten:

- Anyone the journal considers the owner — including `FERNSCOUT_ADMIN_EMAIL`
  (`isAdminEmail`, `lib/admin.ts`). An owner reading their own journal must not
  appear in their own figures.
- Bots. A user-agent substring list (`bot`, `crawl`, `spider`, `preview`,
  `curl`, `wget`, `fetch`) — crude, cheap, and a `ponytail:` comment saying so.
- `test: true` content (`isTestContent`, `lib/access.ts`), which is kept out of
  the feed, the search index and the sitemap for the same reason.
- Prefetches: `Next-Router-Prefetch` on the request means the reader has not
  arrived yet.

### 4. Reading — `lib/analytics/report.ts`

`visitorReport(username, days)` returns, over a window of 7 / 30 / 90 days:

- opens and unique visitors per day, for a sparkline
- the same two totals for the window
- top trips, and top days within a trip, by opens
- gallery opens as its own row, because that was the question asked

Grouping is `count(*)` for opens and `count(distinct visitor_hash)` for
visitors. One query per panel; no cache, no materialised rollup — a 90-day
window on one journal is thousands of rows and this page is opened by one
person occasionally.

### 5. The page — `app/[user]/me/analytics/page.tsx`

- `export const dynamic = "force-dynamic"`, `robots: { index: false }`, the
  same as `/me`.
- Gate: owner only. `resolveViewer(user)` / `isOwner`, and `notFound()` — not
  `403` — for everyone else, so the page's existence is not a fact the URL
  hands out. Read journal access through `resolveAccess(username)` as
  AGENTS.md requires, never `fs_session` directly.
- A link from `/me` for the owner, and nothing in the public nav.
- A plain-language paragraph on the page: what is counted, what is not, that
  the identifier rotates daily, that returning visitors cannot be seen, and
  that owner visits and bots are excluded. The owner is going to be asked by
  their family what this is; the answer should be on the page.
- New locale strings in `site/locales/*.json`, both languages.

### 6. The capability — `analytics` in `FEATURE_NAMES`

`lib/config.ts` and `lib/capabilities.ts`. **Off by default**, as AGENTS.md
requires of every optional capability, and *absent* rather than broken when
off: no recording, no page, no link. `/api/health` explains why it is off. An
instance that never turns it on is byte-for-byte the instance the imprint
already describes, which is what makes the imprint rewrite honest for forks.

### 7. The imprint — `site/legal/en.md` and `site/legal/de.md`

The **No tracking** section is rewritten, not deleted, and it must be true of
this instance as deployed:

- what is counted, and that it is only counted when the operator has enabled it
- that there is no cookie, no third party, no advertising network, no pixel and
  no data leaving the server — all still true
- that the visitor identifier is a hash of an IP and a user agent with a secret
  that is discarded every day, that the IP itself is never stored, and that
  yesterday's rows cannot be linked to today's
- 90-day retention, stated as the same number the code uses
- that there is still no cookie banner, and now *why*: nothing here is stored
  on the reader's device

If the capability is left off on fernscout.ch, the section says so plainly
instead. That is a decision for the deploy, not for this ticket.

### 8. The contract

No `/api/v1/` route is added, so `lib/api/openapi.ts` is untouched — but say
that out loud in the merge, because "touched `app/api/`" is the trigger for
`keep-the-contract` and a reviewer should see it was considered. If a JSON
endpoint is wanted later it is a separate capture.

## Not doing

- **Buddies and trip people.** Asked for, deliberately deferred: the access
  question ("a buddy on one trip sees that trip's numbers and no others") is
  most of the risk in this feature and none of its value until the owner has
  looked at the page once and knows whether the numbers are worth sharing. The
  schema carries `trip_id` on every row so the trip-scoped query is a `where`
  clause when it is wanted, not a migration. Capture it as its own task.
- **Referrers.** A referrer is where a private link was pasted, which is the
  one field here that could expose a reader rather than describe them.
- **Any persistent identifier**, sessions, or returning-visitor figures. This
  is the boundary that keeps the page free of a consent banner; crossing it is
  a different feature with a different imprint.
- **Countries, cities, devices, browsers.** All of them are derived from the
  IP or the user agent, both of which this design exists in order not to keep.
- **A client beacon.** Ruled out above; SPA navigations and lightbox opens are
  not measured and the page should not imply they are.

## What changed while building it

Three things the plan got wrong or did not know, corrected here rather than
left as a Work section describing something nobody built:

- **`app/[user]/page.tsx` does not exist.** The journal's home page *is*
  `app/[user]/(trip)/page.tsx` — `/<user>` renders whichever trip is current.
  So `journal` and `trip` are not two URLs, and the split landed differently:
  `/<user>` records `journal` (with its trip id alongside, so per-trip totals
  still include it) and `/<user>/trips/<id>` records `trip`, which makes that
  kind mean "somebody chose a past trip out of the switcher" — the more
  interesting of the two numbers.
- **Static rendering was a real risk and turned out not to be one.**
  `app/[user]/layout.tsx` already reads `cookies()`, so the whole `/[user]`
  subtree renders per request and recording from a page's render is per-visit
  rather than per-build. Worth knowing before touching this again: if that
  layout ever stops reading a cookie, every count here silently becomes a
  build-time constant.
- **`clientIp` needed widening, not copying.** It took a `Request`, and a
  server component has `await headers()` and no Request. One guard inside the
  shared function (`req instanceof Headers`) rather than a second header
  parser beside it, so the `X-Forwarded-For` trust decision documented there
  stays in one place.

`TranslationKey` is generated — `npm run i18n:keys` after adding strings, or
`tsc` rejects every new `t("…")` call. That is the failure to expect, not a
broken component.

## Found while building

**B571 — an anonymous flood of page requests writes unbounded analytics rows.**
Page renders are not rate-limited (`lib/rateLimit.ts` is called from
`app/api/` only), so every open now costs a row and an unauthenticated loop
costs unbounded rows. Availability rather than disclosure: nothing about a
reader is stored either way. Captured rather than absorbed; it also carries
the two "the numbers can be inflated" notes (a forged `X-Forwarded-For`, and
a second server process holding its own salt).

## Acceptance

- `npm run verify` green.
- With `features.analytics` off: no `/example/me/analytics` (404 for everyone
  including the owner), no rows written, no link on `/me`, and `/api/health`
  naming the capability as off.
- With it on: opening `/example`, a trip, a day and the gallery as a signed-out
  reader writes exactly four rows; opening the same four pages as the owner
  writes none.
- Signed in as a guest, or as a person on a trip, or signed out:
  `/example/me/analytics` is `404`. Signed in as the owner: the page renders.
- A test that pins the identifier's properties: the same request twice within a
  day hashes equal; the same request with yesterday's salt hashes differently;
  the raw IP does not appear in any column of `analytics_events` for any input.
  This is the one test that must not be skipped — it is what the imprint
  paragraph is claiming.
- A test that a row older than 90 days is gone after the page is opened.
- `test/depersonalised.test.ts` and `test/task-ids.test.ts` still pass.
