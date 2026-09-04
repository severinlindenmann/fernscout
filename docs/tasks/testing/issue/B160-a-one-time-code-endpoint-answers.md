---
id: B160
title: A one-time code endpoint answers 202 when the server cannot send mail at all
type: ISSUE
priority: medium
complexity: low
area: auth, mail
found: "2026-09-03T19:34:26Z"
started: "2026-09-04T05:58:31Z"
merged: "2026-09-04T06:14:51Z"
---

# B160 — A one-time code endpoint answers 202 when the server cannot send mail at all

## Why

Found while building B60, and deliberately not absorbed into it: B60 is about
the *per-journal* mail switch, and this is the *server* one.

`POST /api/auth/request` (`app/api/auth/request/route.ts:30`) checks
`isEnabled("auth")` and never `isEnabled("mail")`. When mail is off for the
instance the route still issues a code — `issueCode` writes it to the database,
which revokes any earlier live code for that address — then calls the mail
layer, which returns `null` without sending, and answers `202 {"status":
"accepted"}`.

So on an instance with `auth` on and `mail` off, which is a configuration the
capability registry permits, asking for a sign-in code:

- silently kills whatever code the person may still have had in their inbox,
- leaves a live code nobody has ever been told, and
- reports success.

The route already has the right answer written down for the case where the
transport *throws* — it revokes the code and returns `503 mail_failed` with a
sentence a person can act on (`route.ts:187`). The gap is that "mail is
switched off" is not an exception, so it takes the success path instead.

`POST /api/auth/signup/request` gets this right: it refuses up front with `503
mail_disabled` and says why (`app/api/auth/signup/request/route.ts:27`). So
does `lib/deletions.ts:223`, with a 404. The sign-in route is the one that
does not.

`app/api/contacts/request/route.ts:142` and `.../redeem/route.ts:162` look like
the same shape and are worth checking in the same pass.

## Work

- Decide what a sign-in request should answer when the server cannot send: the
  502/503 the signup route already uses is the obvious candidate, and it leaks
  nothing about the address, which is the property that endpoint's uniform 202
  exists to protect.
- Refuse *before* `issueCode`, not after. Issuing and then revoking leaves a
  window and needlessly burns the code the person is holding.
- Check the two contacts routes for the same shape.
- Not this task: the per-journal switch, which is B60 and shipped.

## Acceptance

- With `features.mail.enabled: false` and `auth` on, `POST /api/auth/request`
  answers something other than 202, and no code is written to the database — a
  test that fails today.
- A code that was already live for that address is still live afterwards.

## Done — 2026-09-04

`POST /api/auth/request` now refuses with **503 `mail_disabled`** when
`isEnabled("mail")` is false, before the rate limit and long before
`issueCode`. The message says nothing has been issued and any code the caller
already holds is still live, which is the fact that matters to the person
reading it.

**Why refusing does not break this endpoint's rule.** Every outcome that
depends on the *address* is still a 202. "This server cannot send mail at all"
is the same answer for every address and every journal, so it discloses nothing
the uniform 202 exists to protect — the same argument the signup route already
made. The route's own docstring said "always answers 202", which had not been
true since the 403 and the `mail_failed` 503 landed; it now lists the refusals
that are exempt and says what they have in common.

**Before the rate limit**, so a request that was never going to work does not
spend a person's five attempts.

Four cases in `test/mail-journal-switch.test.ts`, under *"asking for a code on
a server that cannot send mail"*. The first three fail before the change and
pass after:

- *is refused rather than accepted, and says why*
- *nothing is written to the database*
- *a code that was already live for that address still works afterwards* — the
  expensive half, since `issueCode` revokes before it inserts
- *with mail on it is the ordinary 202 again*, and *a journal's own switch does
  not refuse the request* — the guard rails: a journal that switched its own
  mail off is not this case, because a sign-in code is exempt from that switch
  (B60).

Those tests hand each request its own `X-Forwarded-For`. The agent bucket in
`lib/rateLimit.ts` is module state that outlives `beforeEach`, and without a
distinct address per call the assertions passed or failed depending on how many
earlier tests reached the limiter — which is exactly what happened while the
block was being written, since the fixed route short-circuits before the limit
and the broken one does not.

## The two contacts routes, checked

- **`/api/contacts/redeem`** has the same shape and is **not** fixed here.
  Captured as **B205** rather than absorbed: B160's acceptance names one route,
  and redeem needs its own argument about what a refusal may leak.
- **`/api/contacts/request`** looks like the same shape and is not. Its 202 is
  uniform by construction (B159): the insert, the code and the mail were
  deliberately moved off the response path so a dead invite token and a live one
  cost the same. Refusing there would put the oracle back, in the status line.
  Left exactly as it is, and B205 says so too.
