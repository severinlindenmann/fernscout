---
id: B239
title: A guessed voter id returns another reader's picks across a journal
type: SECURITY
priority: low
complexity: low
area: api, reactions, privacy
found: "2026-09-04T08:21:59Z"
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
