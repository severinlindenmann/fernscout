---
id: B237
title: A mistyped name or address on the redeem form spends one of five slots per quarter hour, so correcting it can lock somebody out of an invitation
type: ISSUE
priority: low
complexity: low
area: contacts, rate-limiting
found: "2026-09-04T08:12:03Z"
started: "2026-09-07T10:37:41Z"
merged: "2026-09-07T11:08:38Z"
completed: "2026-09-07T13:07:20Z"
---

# B237 — A mistyped name or address on the redeem form spends one of five slots per quarter hour, so correcting it can lock somebody out of an invitation

## Why

Found while building B217, which is the same shape on `POST /api/v1/journals`
and which asks, in its Work section, that the other pre-auth limiters be
checked for it. Two were named there — `auth-signup` and `contacts-request` —
and both are fine (see B217 for why). This is the third, and it is not fine.

`POST /api/contacts/redeem` (`app/api/contacts/redeem/route.ts:66`) takes a
slot before it has looked at anything: **five per address per fifteen minutes**,
counted on the attempt. Everything the route refuses afterwards spends one —
`invalid_email`, `invalid_name`, `mail_disabled` (B205), and the `202
{"status":"expired"}` that a mismatched `kind` produces.

The person on the other end of this one is not an agent with a token. It is
somebody's grandmother, on a phone, filling in a form she was sent a link to.
Two typed addresses and a name she corrects is three of the five, and a
household behind one router shares the count — which is exactly the group most
likely to redeem the same invitation within a few minutes of each other, since
the link arrives in one message to one family.

What it costs when it runs out is worse than on the journals route: there is no
error to read. `components/InviteRedeem.tsx` maps 429 to `contact.tooMany`, so
the screen says "too many attempts" to somebody who made three, and the
invitation appears not to work.

B217's shape fits here — count the outcome, keep a looser bucket for refusals —
but the numbers are a different question, because this is a form and not an
API, and 5/15min was chosen against postal-address junk (C15) rather than
against enumeration.

## Work

- Decide what the strict bucket should count. A *completed* redemption — the
  one that issues a code and sends mail — is the expensive act; a refused form
  is not.
- Keep something counting the refusals, for the same reason B217 does: this
  route resolves invite tokens, and a run of refusals is what guessing one
  looks like.
- Check `contacts-confirm` (`app/api/contacts/confirm/route.ts:31`) while in
  there. Wrong codes are the ordinary failure of a six-digit code read off a
  phone, and they are what that bucket is *for*, so it may be right as it
  stands — but the question is the same one.
- Whatever it counts, the 429 should not read as "too many attempts" to
  somebody who made three. See B217 for the shape of a refusal that names its
  budget.

Not this task: `/api/contacts/request`. Its uniform 202 is load-bearing (B159)
and a limiter whose behaviour varies with the outcome would put the oracle back.

## Acceptance

- Somebody who mistypes their address twice on the redeem form can still
  redeem the link.
- A run of redemptions with invented tokens is still stopped.
- A test drives the correcting sequence and asserts the good one goes through.

## Triage

Confirmed as described: one `rateLimitFor("contacts-redeem", ip, {max: 5, …})`
call spent unconditionally at the top of the route, before the token, the
address or the name had been looked at.

**Fix**, in `app/api/contacts/redeem/route.ts` (~line 83 onward), the same
two-bucket shape B217 gives `POST /api/v1/journals`:

- `REDEEMED` (5/15min) — spent only at the two points a redemption actually
  completes: a code issued and mailed (no session), or a signed-in reader's
  contact confirmed. Both are the expensive act — mail sent, or a row written
  into the owner's queue.
- `REFUSED` (20/15min) — spent by every other exit: an invalid/expired/
  mismatched-kind/deleted-trip token (the `202 {"status":"expired"}` responses,
  which is the token-guessing surface this ticket is actually protecting),
  `mail_disabled`, `invalid_email`, `invalid_name`, `invalid_address`,
  `invalid_phone`. A `refuse()` helper (mirroring the one in the journals
  route) is the only thing that spends it.

Two edge-case outcomes — a blocked contact (`result.outcome === "ignored"`)
and `confirmContactFromSession` returning `{ok: false}` (a race: the row
disappeared or was blocked between confirm and this call) — are left
unbudgeted, deliberately: they are not client mistakes and not the enumeration
surface, and the first must keep answering exactly like a success (see the
existing comment above it) so budgeting it would risk telling a blocked
address something the response text does not.

**`contacts-confirm`** (`app/api/contacts/confirm/route.ts:31`) was checked as
the Work section asked. Its 20/15min bucket takes a code, not a name or an
address — a wrong code is the ordinary failure the ticket itself says the
bucket is for, and `verifyCode`'s own five-wrong-guesses-burns-it limit
already protects the code underneath it. Left unchanged.

**Disclosure.** The 429 body now names which budget was hit
(`reason: "redeemed" | "refused"`) with a message saying so, replacing the
undifferentiated `too_many_requests` the shared bucket produced — but
`components/InviteRedeem.tsx` still maps any 429 to the same
`contact.tooMany` string regardless of `reason`, so nothing new reaches the
reader through the UI; the reason is there for anyone reading the response
directly. Neither reason distinguishes anything about a specific address:
both are IP-keyed and general ("this network address"), same as the bucket
they replaced, so nothing here turns the limiter into an oracle for a
particular email or token — that was the property B237 asked to keep.

**Test:** `test/redeem-rate-limit.test.ts` (new file). Covers: two mistyped
addresses plus a correction from one IP all succeed (the acceptance
criterion, and previously would have been 3 of the 5 shared slots); real
completions still exhaust `REDEEMED` and the sixth is refused with a message
naming the budget; twenty invented tokens from one IP exhaust `REFUSED` and a
21st is refused. Confirmed each assertion fails against the pre-fix route
(429 where 202 was expected on the correction case; the wrong bucket size on
the other two) and passes after.

**Acceptance:** met. `npm run verify` passes in full.
