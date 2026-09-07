---
id: B712
title: The helper routes are undocumented in the agent guide
type: DOCS
priority: medium
complexity: low
area: docs, api, agent
found: "2026-09-07T11:17:15Z"
started: "2026-09-07T11:40:42Z"
merged: "2026-09-07T12:37:30Z"
completed: "2026-09-07T13:14:15Z"
---

# B712 — The helper routes are undocumented in the agent guide

## Why

B682 added `/api/helper/[user]/day`, `.../media` and `.../publish`. They are
cookie-only and deliberately outside `/api/v1`, which is why
`test/openapi-contract.test.ts` does not walk them and nothing failed.

That is the right design and the wrong silence. `docs/plans/2026-09-07-web-helper-agent.md`
§4 says `/agent.md` gains a short section explaining that the helper has its
own browser-only routes — precisely so an agent reading the contract does not
conclude the site has privileges the documented API lacks, or go looking for
endpoints it is not entitled to call.

Nothing enforces it, which is why it was missed.

## Work

A short section in `/agent.md` (via `lib/api/documentation.ts`, or
`lib/api/agentCopy.ts` if more than one document has to say it): the helper at
`/agent` drives the same `lib/api/*` functions through cookie-only routes under
`/api/helper/`, they refuse bearer tokens, and they are not part of the public
contract. Say what an agent should use instead — which is everything already
documented.

Consider whether `test/api-route-schemas.test.ts` should assert that anything
under `app/api/helper/` refuses an `Authorization` header, so the claim stays
true.

## Acceptance

`/agent.md` explains the helper routes and why they are not in the OpenAPI
document. A test asserts a bearer token is refused there.

## Done

Added a new `## A web helper exists too, and it is not part of this contract`
section to `agentGuide()` in `lib/api/documentation.ts` (renders into
`/agent.md`), right after "Authenticating" and before "Reading" — the natural
spot, since it's the section that already establishes how a bearer token is
obtained and used. It says: `/api/helper/<user>/...` exists, is cookie-only,
owner-only, and outside `/openapi.json` on purpose; that an `Authorization`
header is never read there at all (not merely insufficient); and that
whatever the wizard does, a documented `/api/v1` call already does the same
thing through the same underlying functions.

Test coverage, two files:

- `test/agent-interface.test.ts` — one new test asserting `agentGuide()`
  mentions `/api/helper/`, "cookie-only", and that it's outside the contract.
- `test/helper-routes-bearer-refused.test.ts` (new) — the "assert a bearer
  token is refused" half. Issues a *real* agent token (via `issueCode`/
  `verifyCode`, same as `test/helper-write-day.test.ts`) for the journal's
  actual owner, mocks `next/headers`'s `cookies()` to an empty jar (so
  `resolveAccess` runs unmocked and genuinely has no cookie to find — not a
  stubbed "always refuse"), and calls every exported handler across all five
  route files (`consent` POST/DELETE, `day` GET/POST/PATCH, `day/publish`
  POST, `day/media` GET/POST, `day/write-day` POST) with `Authorization:
  Bearer <token>` and no cookie. All ten asserts get `404 not_your_journal`.
  9/9 tests (5 test cases) pass.

Did not touch `test/api-route-schemas.test.ts` as the ticket's "consider"
suggested — that file only walks `app/api/v1/`, and adding helper coverage
there would have meant either broadening its scope (a bigger, unrelated
change) or duplicating what `helper-routes-bearer-refused.test.ts` already
proves more directly by calling the real handlers. The new test file is the
more precise check: it doesn't just assert the routes don't read a header, it
proves a *real, validly-issued* token for the *actual owner* still gets
refused.
