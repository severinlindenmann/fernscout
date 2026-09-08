---
id: B776
title: An agent token can mint itself a fresh token forever without the owner ever seeing a code
type: SECURITY
priority: high
complexity: medium
area: auth, tokens
found: "2026-09-07T14:23:36Z"
started: "2026-09-08T05:12:26Z"
session: 41335894-5435-4167-8cb6-898e370cd6a9
claimed: "2026-09-08T05:12:26Z"
---

# B776 — An agent token can mint itself a fresh token forever without the owner ever seeing a code

## Why

An ordinary seven-day agent token can mint itself a **new** seven-day token,
forever, without the owner ever seeing a code again.

Demonstrated live on 2026-09-07:

1. `POST /api/v1/<user>/handover` with `Authorization: Bearer fs_agent_…` →
   `200`, returning a `fs_handover_…` credential. No cookie involved.
2. `POST /api/auth/handover` with that credential → `200`, a brand new
   independent `fs_agent_…` token with a fresh seven-day clock.

`app/api/v1/[user]/handover/route.ts` guards with `isOwner(user, request)`,
which accepts **cookie or bearer** — deliberately, and its doc comment says so.
`/openapi.json` documents "cookie or bearer" too. `/agent.md` does not: it
presents handover entirely as something "the owner's own page" does, which is
the document an agent actually reads.

So the seven-day limit, which B283 chose deliberately over printing a
long-lived token into a clipboard, is not a limit on an agent that already
holds one. It is a limit on an agent that stops renewing. Revocation still
works — the owner can revoke from `/<user>/contacts` — but a person reading
"seven days" has been told the credential expires by itself, and for a
self-renewing agent it does not.

Whether this is a hole or a feature is a decision, not a bug report, and it is
the owner's to make. What is certainly wrong is that the guide an agent reads
does not mention it.

## Work

Decide, and write the decision down where it is read:

- **If self-renewal is intended** — it is convenient, and the token is already
  revocable — then say so plainly in `/agent.md`, and say it on the owner's own
  page too: a live agent token can keep itself alive, and revoking is how it
  ends.
- **If it is not**, the fix is small: refuse `POST …/handover` when the caller
  is a bearer rather than a cookie, since the route exists so that a *person on
  a page* can hand a credential to an agent. Check what breaks — the route is
  also used by `/<user>/trips`, and B283's whole point was the owner's page.

Either way, consider showing the owner when a token was last renewed, so
"seven days" is checkable rather than assumed.

## Acceptance

`/agent.md` and the owner's access page agree with the code about what a
seven-day token can do to its own lifetime.
