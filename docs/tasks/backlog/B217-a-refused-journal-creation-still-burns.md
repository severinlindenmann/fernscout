---
id: B217
title: A refused journal creation still burns a rate-limit slot, so correcting a typo can lock the person out for an hour
type: ISSUE
priority: medium
complexity: low
area: api, rate-limiting, journals
found: "2026-09-04"
---

# B217 — The token survives a mistake; the IP budget does not

## Why

Found while verifying B55, which passes. B55's guarantee is real and was
observed in both directions: a signup token survives a refused creation
(`409 username_taken`, `400 deleted_username`, `400 reserved_username` — three
in a row on one token) and is spent by a successful one. `/agent.md` states it,
and the point is explicit — "a taken username is worth correcting rather than
starting over", so a person does not have to go back to their inbox.

The rate limiter does not honour that. `app/api/v1/journals/route.ts` calls

```ts
rateLimitFor("journals-create", clientIp(request), { max: 5, windowMs: 60*60*1000 })
```

**before authentication and before validation.** So every refusal — a taken
name, a reserved name, a typo that is not a username at all — consumes one of
five slots per IP per hour.

Observed live: a third probe in one window answered
`429 {"error":"too_many_requests","retryAfter":2251}`.

So the promise holds at the credential and breaks at the address. An agent
helping somebody pick a name gets three or four corrections and is then locked
out for the rest of the hour, holding a token that is still perfectly valid and
a person who is still standing there. The failure also arrives as a bare
`429` with no hint that the earlier *refusals* were what spent the budget —
which reads as "the server is busy", not "you have used your attempts".

This is a small hole in a well-made guarantee, and it is worth closing because
the guarantee is the thing that makes name-picking conversational.

## Work

Two independent options; the first is probably right and they compose.

- **Count the outcome, not the attempt.** Move the limiter after validation and
  authentication so a refused creation does not consume a slot — or refund the
  slot on a 4xx that is the caller correcting themselves. That makes the IP
  budget match what `/agent.md` already promises about the token.
  Weigh the counter-argument honestly: the limiter also exists to make *name
  enumeration* expensive, and enumeration is exactly a sequence of refusals. So
  do not simply stop counting them — keep a separate, looser bucket for refusals
  (say 20/hour) and the strict 5/hour for creations that succeed. Enumeration
  stays costly, correcting a typo does not.
- **Say what happened.** The `429` should distinguish "you have created five
  journals this hour" from "you have made twenty failed attempts", and name the
  wait. `retryAfter` is already in the body; the reason is not.

While in there, check the other pre-auth limiters for the same shape —
`auth-signup` and `contacts-request` are both keyed on IP and both sit ahead of
validation.

## Acceptance

- A signup token can correct a mistyped or taken username several times over
  without the IP budget refusing the eventual successful creation.
- Enumerating names is still expensive — a refusal bucket exists and is
  demonstrably tighter than unlimited.
- A `429` from this route says which budget was exhausted.
- A test drives four refusals then a success on one token and asserts the
  success is not refused.
