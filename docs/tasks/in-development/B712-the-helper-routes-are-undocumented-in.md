---
id: B712
title: The helper routes are undocumented in the agent guide
type: DOCS
priority: medium
complexity: low
area: docs, api, agent
found: "2026-09-07T11:17:15Z"
started: "2026-09-07T11:40:42Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:42Z"
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
