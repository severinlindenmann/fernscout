---
id: B239
title: A guessed voter id returns another reader's picks across a journal
type: SECURITY
priority: low
complexity: low
area: api, reactions, privacy
found: "2026-09-04T08:21:59Z"
started: "2026-09-07T11:06:11Z"
merged: "2026-09-07T11:32:20Z"
---

# B239 — A guessed voter id returns another reader's picks across a journal

## Why

`GET /api/reactions?voter=<id>&trip=<ref>` answers with `getVotesFor(voterId,
ref)`, and that call is scoped to the **journal**, not to the trip
(`lib/reactions.ts`, `scopeToJournal`). So the answer is every reaction that
voter has recorded anywhere in that journal, keyed
`<username>/<trip-id>:<day-slug>`.

That is deliberate and stated: one browser has one voter id, and the story
pager wants this reader's picks for the whole journal in one request rather
than one per trip. What is not stated is that the voter id is the only thing
standing between a caller and somebody else's answer. It is a `crypto.randomUUID()`
in `localStorage` (`components/ReactionsProvider.tsx`), so it is not guessable
— but it is not a secret either: it travels in a **query string**, which is the
part of a URL that lands in access logs, in `Referer`, and in any proxy between
the reader and the server. Anyone holding one gets the day slugs of every trip
in that journal the reader reacted to, including closed ones they were entitled
to read and the caller is not.

Noticed while fixing B232, which gated the *trip* on `mayReadTrip` and
deliberately left this alone: it is a different question with a different
answer, and folding it in would have been scope absorbed rather than captured.
The trip named in the request is now gated, so the leak is bounded to slugs the
holder of the id could reach — but the slugs come from other trips, not from
the one asked about, which is the part worth a second look.

## Work

Decide what the guarantee is meant to be, then make the code say it. Three
shapes, in increasing cost:

- **Scope the answer to the trip that was asked about**, and let the pager make
  one request per trip. Smallest change; costs the round trips the current
  shape exists to avoid.
- **Filter to trips the caller may read**, using the same `mayReadTrip` the
  route now applies to the trip in the request. Keeps the one-request shape and
  makes the answer depend on the caller rather than on the id.
- **Move the voter id out of the query string** into a POST body or a cookie,
  so it stops being logged. Does not fix the "anyone holding one" case on its
  own.

Not doing: the voter-id scheme itself. A random id in `localStorage` is the
right primitive for "which of these did I already tap" without an account.

## Acceptance

- A request carrying somebody else's voter id does not return day slugs from a
  trip the caller may not read.
- The story pager still shows a reader's own previous picks without a request
  per day.
- A test in `test/sweep-b22-disclosure.test.ts` or alongside it, driving the
  real route.

## Resolution

Took the first, smallest shape: `getVotesFor` (`lib/reactions.ts:37`) now
calls a new `scopeToTrip()` instead of `scopeToJournal()`, keeping only rows
whose key starts with `${ref}:` — one trip, not the whole journal.
`scopeToJournal` is kept (nothing else changes) because it states a real,
narrower-than-nothing guarantee and its own test (`test/reactions.test.ts`)
still pins it; it is simply no longer what `getVotesFor` calls.

Checked the "costs the round trips" worry in the Work section against the
actual caller before picking the shape: `ReactionsProvider`
(`components/ReactionsProvider.tsx`) is mounted once per trip page and already
fetches `/api/reactions?...&trip=<tripId>` for that one trip — it never
relies on one request covering several trips. So the journal-spanning shape
`getVotesFor`'s old docblock described was aspirational and not exercised by
the one client there is; trip-scoping it costs nothing today. If a future
caller genuinely wants "this reader's picks across the whole journal in one
request," that is `scopeToJournal` waiting, unused, right there — this
ticket does not delete the capability, it just stops the one route that
didn't need it from defaulting to it.

**The harder question — should a guessed id return anything at all?** Yes,
and the answer does not change: the id is a `crypto.randomUUID()`
(122 bits), not a password or a sequential id, so *guessing* one is not a
practical attack — the ticket's own title undersells this; the real threat
named in the Why is a **leaked** id (query string → access log / `Referer` /
proxy), not a *guessed* one. Given a real, held id, the question becomes
"what can its holder learn about a trip they cannot otherwise read", and the
route's existing `mayReadTrip` gate (B232) already answers that for the trip
*named in the request*: a trip the caller may not read answers `400
unknown_trip` before `getVotesFor` is ever called, identically to a trip that
does not exist. What B239 closes is the remaining gap — the *other* trips'
slugs the old journal-wide scope smuggled in through the side door of a
request that named a trip the caller **was** allowed to read. With
`scopeToTrip`, a caller can never learn more from `mine` than "did this voter
id react to a day in the one trip I already asked about, and got past
`mayReadTrip` for" — which is no more than the counts (`getAllCounts`) already
tell every reader of that trip. So: revoking the ability to answer at all
(e.g. requiring the voter id never leave the browser) was considered and
rejected as disproportionate — the id carries no identity, only "which of
these reactions is mine", and the fix that matters is bounding what one
answer can span, not refusing to answer.

**What the door now tells a caller who is not entitled to the answer:** the
same as before B239 for the trip actually named in the request — nothing new,
`mayReadTrip` already gates that — and, new since this fix, nothing at all
about any *other* trip in the journal, where before it silently listed every
day slug that voter id had reacted to. A caller holding a leaked id and a
trip ref they may read now learns exactly what an ordinary reader of that
trip already sees in the counts, plus which of those reactions belong to that
one id — never a slug from a trip outside the one they asked about and were
already let into.

Tests: `test/reactions.test.ts` (`scopeToTrip` unit tests, mirroring the
existing `scopeToJournal` ones) and `test/sweep-b22-disclosure.test.ts`
(`B239` describe block) — driving the real route with a voter id shared
between a private trip and a public one, asserting the private trip's day
slug never appears in the public trip's answer, and that the voter's own
picks on the trip actually asked about still come back.
