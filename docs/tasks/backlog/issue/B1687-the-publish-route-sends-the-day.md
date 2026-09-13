---
id: B1687
title: The publish route sends the day letter with no channel claim, so two concurrent publishes mail it twice
type: ISSUE
priority: medium
complexity: low
area: Credits
found: "2026-09-13T18:15:12Z"
---

# B1687 — The publish route sends the day letter with no channel claim, so two concurrent publishes mail it twice

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found while fixing B1663. `app/api/v2/{user}/trips/{trip}/days/{slug}/publish`
calls `sendDayLetter` — the **mail** channel — with exactly the shape
`sendDayWhatsapp` had before B1663: no `claimChannel` around it, the same
synchronous-write-then-send structure, the same concurrent-publish race.

An ordinary retry is already closed: `writeDayFile` flips the day out of
`draft` before any send, so a repeated publish request answers
`already_published` and never reaches the send. What is open is two
**concurrent** publishes — two processes behind a load balancer, or two racing
requests — both reading the day as still `draft` before either write lands,
and both mailing it.

**Double-sending somebody's day is worse than double-charging for it.** The
charge is recoverable; the mail is in the reader's inbox. That is why this is
filed rather than left as an accepted race.

The guard already exists and is already used by the owner's own manual resend
button (`lib/digest/dayNotify.ts`): `claimChannel` is a database unique-index
compare-and-swap, with `releaseChannelClaim` for an ordinary refusal. B1663
wired it around the whatsapp branch of this same route. The mail branch was
out of that ticket's five named paths, so it was left.

## Work

Wrap the `sendMailRequested` branch in
`claimChannel(user, tripId, v1Slug(slug), "mail")` / `releaseChannelClaim`,
matching the whatsapp branch directly above it.

A lost claim must leave `mail` **absent** from the response rather than
reported as sent — the same silence the notify route already gives for a
channel already spoken for. Never invent an outcome for a send that did not
happen.

## Acceptance

A test in the shape of `test/publish-day-whatsapp-idempotency.test.ts`: mock
`claimChannel` to refuse, assert the route calls it, sends nothing, and reports
no mail outcome. It must fail when the guard is removed.

Note for whoever builds it: B1663 could not reproduce the genuine concurrent
race inside one Node test process, because `readDayFile`/`writeDayFile` are
synchronous and two `Promise.all` calls serialise through them. It pinned the
mechanism instead and said so in the test's own comment. Do the same rather
than shipping a race test that cannot fail honestly.
