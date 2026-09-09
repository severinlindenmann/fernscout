---
id: B1026
title: A malformed auth/request body answers the same 202 as an unrecognised address
type: ISSUE
priority: low
complexity: low
area: auth, api
found: "2026-09-08T19:48:47Z"
started: "2026-09-09T06:09:46Z"
session: f88144a1-6520-4fc1-94bd-496a694b98c8
claimed: "2026-09-09T06:09:46Z"
---

# B1026 — A malformed auth/request body answers the same 202 as an unrecognised address

## Why

Found while working B801, which drew the same distinction for
`POST /api/contacts/request`'s `invite` field: a *malformed* request (a
field missing entirely) is safe to refuse by name, because refusing it
discloses nothing the caller doesn't already know they sent; a *wrong value*
has to stay folded into the route's uniform answer, or the route becomes an
oracle for guessing it.

`app/api/auth/request/route.ts` (`const accepted = Response.json({ status:
"accepted" }, { status: 202 }); if (!isEmail(email) || !username) return
accepted;`) currently answers the identical `202 accepted` for three
different things: no `email` field at all, an `email` that fails `isEmail`
syntactically, and a syntactically-valid address this journal has never
heard of. Only the last of those is the case the uniform answer exists to
protect — "which of somebody's family is registered" only becomes
answerable if the response varies with *whether an address is known*.
Whether `isEmail()` accepts the string is a pure format check, independent
of any account, so refusing it by name leaks nothing about who is
registered — the same shape as the `invite` fix in B801, and the same shape
`resolveInvite` there draws between "no token" and "a token that doesn't
resolve".

## Work

Check whether `email`/`username` being present-but-malformed (missing,
empty, or failing `isEmail`) can be refused with a `400` naming the field,
while every address that *is* syntactically valid — known or not — keeps the
existing uniform `202`. This needs care this ticket didn't get:
`/api/auth/request` is a higher-traffic, more heavily tested route than
contacts/request (`mayRequestAgentToken`, the agent/guest split, the
destination-safety check all sit downstream of this same body), so trace
every existing test asserting `202` for a bad body before changing the
branch — some of those tests may currently be testing the very shape this
ticket wants to split apart.

## Acceptance

A request with no `email` field, or an `email` that is not a syntactically
valid address, is refused with a `400` naming the field. A request whose
`email` is syntactically valid but unrecognised by the journal — the
existing "does this address exist" case the uniform answer protects —
still answers `202` exactly as before.
