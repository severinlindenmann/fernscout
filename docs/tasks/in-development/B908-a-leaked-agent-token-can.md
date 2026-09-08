
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
