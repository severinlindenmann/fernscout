---
id: B237
title: A mistyped name or address on the redeem form spends one of five slots per quarter hour, so correcting it can lock somebody out of an invitation
type: ISSUE
priority: low
complexity: low
area: contacts, rate-limiting
found: "2026-09-04T08:12:03Z"
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
