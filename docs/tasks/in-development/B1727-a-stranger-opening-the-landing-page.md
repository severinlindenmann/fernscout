---
id: B1727
title: A stranger opening the landing page gets a 401 in their console
type: ISSUE
priority: low
complexity: low
area: auth, landing
found: "2026-09-14T10:48:00Z"
started: "2026-09-14T10:58:07Z"
session: 7c5b9049-8b95-4498-9456-3bc0d44db73e
claimed: "2026-09-14T10:58:07Z"
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

## Verdict

**Valid.** `app/api/auth/identity/upgrade/route.ts:63` answered `401
no_session` for an empty jar, and `components/Landing.tsx:192` fires that
request for every visitor `/api/v2/me/home` reports as nobody. Reproduced
before the change: a browser capture of the landing page listed `401
http://127.0.0.1:3456/api/auth/identity/upgrade` as its one failed request
(`/tmp/b1726/index.json`, taken while building B1726).

## What was done

- The `!session` branch answers `200 {ok:true, issued:false}` — the same
  shape the already-has-one branch returns. Nothing else on the path moved.
- `no_session` removed from `lib/api/errorCodes.ts`. It was the only route
  that spoke it, and `test/openapi-contract.test.ts:437` refuses a documented
  code no route returns — which is how the contract keeper found it.
- The two keepers that asserted `401` now assert what actually matters:
  status `200` with `issued: false` for an empty jar, and `issued: false`
  with no cookie written for an agent token in the cookie jar.
- `test/landing-identity-upgrade.test.tsx` mocked the old `401`; its stranger
  case now mocks what the route really answers.

`/openapi.json` needed no change — the cookie-lifecycle doors carry no
schema, by `docs/plans/2026-09-12-api-v2/auth.md:8`. That plan's line 223 does
describe the old `401`; it is a record of a decision taken then, not a live
contract, and is left as written.

## Evidence

- `npm run verify` — all 5 passed in 238s.
- `curl -X POST http://127.0.0.1:3457/api/auth/identity/upgrade` with an empty
  jar → `HTTP/1.1 200` and `{"ok":true,"issued":false}`.
- Browser, signed out, 1280 and 390: `/tmp/b1727/index-{1280,390}.png` and
  `index.json` — status 200, **0 console errors, 0 failed requests**, against
  the one failed request the same capture showed before the change. The
  signed-out landing page is unchanged.
- An agent token in `fs_session` mints nothing —
  `test/identity-upgrade.test.ts`, keeper kept, assertion moved off the status.
- A live guest cookie still mints one, once — the two keepers either side of
  it, unchanged.
- Security review over the branch: no findings. Minting is still gated on a
  live guest session, the kind check still turns an agent token away by
  minting nothing, and the new response is less distinguishing than the old
  one, not more.
