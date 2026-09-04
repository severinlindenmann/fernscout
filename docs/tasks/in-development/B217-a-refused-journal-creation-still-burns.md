---
id: B217
title: A refused journal creation still burns a rate-limit slot, so correcting a typo can lock the person out for an hour
type: ISSUE
priority: medium
complexity: low
area: api, rate-limiting, journals
found: "2026-09-04"
started: "2026-09-04T07:52:18Z"
session: 7d30451d-0304-4631-8484-d96036fb11b4
claimed: "2026-09-04T07:52:18Z"
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

## What was built

Both options, because they do compose.

**Two buckets, counted on the outcome.** `app/api/v1/journals/route.ts` reads
both budgets at the top with `rateLimitStatus` — a new, non-consuming peek in
`lib/rateLimit.ts` — and spends neither, because which bucket a request belongs
to is not knowable before the work. `journals-create` stays 5/hour and is spent
by `rateLimitFor` only after `createJournal` has succeeded; a new
`journals-create-refused` bucket, 20/hour, is spent by every refusal.

Every 4xx now returns through one local `refuse()` helper rather than building
its own `Response`, so a refusal added later cannot quietly become free. That
is the part worth keeping an eye on in review: the route's invariant is that
nothing returns a non-2xx except through `refuse` or `tooMany`.

**The 429 says which.** A `reason` field — `journals_created` or
`failed_attempts` — plus a sentence. The failed-attempts one says in words that
the token is still good and creating a journal is still allowed, because the
bare `too_many_requests` read as "the server is busy" and an agent had no way
to learn that its own refused names were what spent the budget. `retryAfter`
and the `Retry-After` header are unchanged. `/agent.md`'s error table carries
the distinction.

### The other pre-auth limiters, as asked

- **`auth-signup`** (`app/api/auth/signup/request/route.ts:39`) — correct as
  it stands. Every outcome below it is `202 accepted`, including a malformed
  address, so there is no refusal to separate out; the bucket counts codes
  issued, which is what it should count. The one arguable case is the
  `mail_failed` 503, which spends a slot for a send that failed — but the code
  is revoked with it and the server's mail is broken anyway, so five attempts
  an hour against a broken transport is a reasonable thing to allow.
- **`contacts-request`** (`app/api/contacts/request/route.ts:69`) — must not
  change. Its uniform 202 is load-bearing (B159): a limiter whose behaviour
  varied with the outcome would put back the oracle that was deliberately
  removed.
- **`contacts-redeem`** (`app/api/contacts/redeem/route.ts:66`) — not named in
  the Work section, and it *does* have the shape: 5 per address per fifteen
  minutes, counted on the attempt, in front of a form a person fills in by
  hand. Captured as **B237** rather than absorbed, because the numbers there
  are a different argument — that limit was set against postal-address junk,
  not against enumeration.

## Acceptance

- A signup token can correct a mistyped or taken username several times over
  without the IP budget refusing the eventual successful creation. ✅ — six
  refusals then a success, from one address, in
  `test/journals-rate-limit.test.ts`.
- Enumerating names is still expensive — a refusal bucket exists and is
  demonstrably tighter than unlimited. ✅ — the twenty-first refusal from one
  address is a 429 with `reason: "failed_attempts"`.
- A `429` from this route says which budget was exhausted. ✅ — both are driven
  and asserted to differ: five creations then a sixth gives
  `journals_created`, twenty refusals give `failed_attempts`.
- A test drives four refusals then a success on one token and asserts the
  success is not refused. ✅ — written as specified. **It passed before the
  change as well**, and that is worth saying rather than presenting it as
  proof: four refusals plus one success is exactly the five the old single
  bucket allowed. The sixth-refusal test is the one that fails without the fix.

## Evidence

```
$ npx vitest run test/journals-rate-limit.test.ts   # route + rateLimit stashed
  × six refusals then a success, and the success is still not refused
      AssertionError: expected 429 to be 400
  × a run of refusals is stopped, well short of unlimited
  × five creations from one address, and the sixth waits
      AssertionError: expected undefined to be 'journals_created'
  × the two 429s do not say the same thing
  Tests  4 failed | 1 passed (5)

$ npx vitest run test/journals-rate-limit.test.ts   # with the fix
  Tests  5 passed (5)
```
