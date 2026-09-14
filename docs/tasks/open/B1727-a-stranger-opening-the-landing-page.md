---
id: B1727
title: A stranger opening the landing page gets a 401 in their console
type: ISSUE
priority: low
complexity: low
area: auth, landing
found: "2026-09-14T10:48:00Z"
---

# B1727 — A stranger opening the landing page gets a 401 in their console

## Why

Opening https://fernscout.ch/ signed out prints:

> POST https://fernscout.ch/api/auth/identity/upgrade 401 (Unauthorized)

`components/Landing.tsx` (B1493) asks `/api/v2/me/home` first; when it answers
`id: null` it fires the upgrade probe once, because a reader signed in before
B410 looks exactly like a stranger from there. Both cookies are httpOnly, so
the client cannot tell the two apart — the probe has to be fired blind, and
for every genuine stranger it comes back 401. `IdentityUpgrade` is fine: the
journal layout renders it only for a reader who already holds `fs_session`.

The route answers `401 {error:"no_session"}` for an empty jar. Nothing is
wrong — the answer to "have you anything to upgrade?" is "no". A status that
says the caller was refused, for a question that was answered, is what puts a
red line in every visitor's console.

## Work

`app/api/auth/identity/upgrade/route.ts`: when no guest session resolves,
answer `200 {ok:true, issued:false}` — the same shape the already-has-one
branch returns. Nothing else changes: no cookie is written, the kind check
still refuses an agent token down the cookie channel, and the rate limit stays
where it is.

This is a deliberate contract change, so the two keepers in
`test/identity-upgrade.test.ts` that assert `401` change with it — keep their
`written.fs_identity` assertions exactly as they are, since minting nothing is
the part that matters. Check `/openapi.json` and the API guides still describe
the route truthfully (`keep-the-contract`).

Auth route: needs the security review path before merge.

## Acceptance

- A signed-out load of `/` produces no console error.
- An agent token presented in `fs_session` still mints no identity.
- A pre-B410 reader holding `fs_session` still gets one, once.
