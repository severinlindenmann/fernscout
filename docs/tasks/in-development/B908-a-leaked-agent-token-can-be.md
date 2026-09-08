---
id: B908
title: A leaked agent token can be listed and not ended
type: SECURITY
priority: medium
complexity: low
area: api, auth
found: "2026-09-08T04:57:41Z"
started: "2026-09-08T06:07:58Z"
session: 41335894-5435-4167-8cb6-898e370cd6a9
claimed: "2026-09-08T06:07:58Z"
---

# B908 — A leaked agent token can be listed and not ended

## Why

`GET /api/v1/<user>/keys` lists the agent tokens a journal has issued.
`POST /api/v1/<user>/keys` issues one. There is no `DELETE`.

So a token that has leaked can be **seen and not ended** through the API. The
owner's contacts page can revoke, which means the capability exists and only
the documented door is missing — but an agent told to clean up after itself,
or an owner working from a script, cannot.

This compounds B776, where a live token can mint itself a fresh one
indefinitely: the renewal path is open and the ending path is not.

Found by mapping every operation to a chat shape, 2026-09-08.

## Work

`DELETE /api/v1/<user>/keys/<id>`, owner only, mirroring how the contacts page
already revokes. Say in `/agent.md` that an agent which no longer needs its
token should end it, beside the sentence that already tells it to say so.

Check B776 while there: if a token may renew itself, revocation is the only
thing that bounds it, and it should be reachable from everywhere the renewal
is.

## Acceptance

A token that can be issued over the API can be ended over the API.
