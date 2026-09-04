---
id: B160
title: A one-time code endpoint answers 202 when the server cannot send mail at all
type: ISSUE
priority: medium
complexity: low
area: auth, mail
found: "2026-09-03T19:34:26Z"
started: "2026-09-04T05:58:31Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:31Z"
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
