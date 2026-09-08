---
id: B908
title: A leaked agent token can be listed and not ended
type: SECURITY
priority: medium
complexity: low
area: api, auth
found: "2026-09-08T04:57:41Z"
started: "2026-09-08T06:07:58Z"
merged: "2026-09-08T06:18:28Z"
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


## Outcome (2026-09-08) — half the premise was wrong, and the other half was real

**Revocation over the API already existed.** The capture read
`app/api/v1/[user]/keys/route.ts` as "GET lists, POST issues, there is no
DELETE". `POST` is not issuing — it *is* the revoke: `{"revoke": "<key id>"}`,
owner-or-own-address, idempotent, immediate, and documented in
`/openapi.json` since B283 with all five of its refusals. Issuing happens at
`…/handover`, not here. So a leaked token could always be ended over the API.

**No `DELETE` was added.** A second door onto a capability that already has a
documented one is the thing not to build: the page's own button posts to this
route, the id comes from the `GET` beside it, and an alias would be one more
shape for the next reader to reconcile.

**What was actually missing is what B908's second Work item names:**
`/agent.md` did not mention `/keys` at all — the word appears nowhere in the
guide. An agent was told "tell them if you no longer need it — they can revoke
it", when it could revoke it itself. That sentence is now there, beside B776's
new paragraph about renewal, since the two are one subject: renewal is what
makes a token outlive its seven days, and revocation is the only thing that
bounds it.

`test/handover.test.ts` gains the case that matters — a token listing itself,
revoking itself with itself, and being refused on the call after — because a
sentence in the guide is a claim, and this is the claim.

Raised the guide's byte ceiling from 135 to 136 KiB, with the reason written
into `test/agent-interface.test.ts` as that test asks.
