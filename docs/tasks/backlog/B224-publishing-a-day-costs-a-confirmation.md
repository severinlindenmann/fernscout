---
id: B224
title: Publishing a day costs a confirmation round trip the new doctrine does not want
type: FEATURE
priority: high
complexity: medium
area: api, mcp, drafts
found: "2026-09-04T07:31:05Z"
---

# B224 — Publishing a day costs a confirmation round trip the new doctrine does not want

## Why

B28 built publishing as a two-step handshake, modelled on deletion: the first
`POST .../days/<slug>/publish` is refused with a `confirmation_required` code
bound to that one journal, trip, day and verb, and only the second call with
that code publishes. `publish_day` over MCP does the same.

B28 was explicit that this buys less than it looks like. Its own route comment
says so: *"an agent can make both calls without asking anybody. It is not proof
a human consented."* The ceremony was there to make publishing feel like a
deliberate act while the doctrine still held that publishing was reserved for a
person and an endpoint was a concession.

That doctrine has been replaced (B223, author's decision 2026-09-04): the agent
is the editor — it writes, it publishes, it corrects. Under that rule the
handshake is no longer a weakened guarantee standing in for a strong one; it is
just a round trip that buys nothing. Its remaining costs are real:

- Every published day is two calls, so writing up a week is fourteen.
- The refusal is a *failure shape* on the success path. An agent that treats a
  non-2xx as an error — many will — reports "publishing failed" the first time
  and needs the guide to tell it otherwise.
- It makes batch publishing awkward on purpose, which was the point when
  batching was suspect and is now friction against the intended workflow.

Deletion keeps its confirmation and should. Deletion is unrecoverable and its
second step happens in a mailbox (`lib/deletions.ts`, B38); publishing is
reversible by putting the line back.

## Work

- Drop `confirmationRequired` / `confirmationMatches` from
  `app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route.ts` and from
  `publishDayTool` in `lib/mcp/tools.ts`. A first call publishes.
- Leave `lib/agentConfirm.ts` in place — deletion still uses it. Remove only the
  `publish_day` verb if nothing else references it.
- **Keep everything else about the endpoint.** Owner-only stands: a trip-scoped
  token writes days into a trip and cannot publish them, because being on the
  bus is not the same as deciding what the journal says. Publishing twice is
  still refused rather than shrugged off, for the reason B28 gives — an agent
  that gets a cheerful `200` might tell somebody it had just done a thing that
  happened last week.
- Update `/agent.md`'s "Publishing, when they say so" and the `publish_day`
  description: the confirmation paragraph goes, **"ask them, in words, and wait
  for an answer" stays**. That instruction never depended on the code, and it is
  now the only thing standing between a person and a published day.
- `app/openapi.json/route.ts` — the publish path loses its 409 confirmation
  response.
- `test/publish.test.ts` and the publish cases in `test/mcp.test.ts` — the
  handshake tests become single-call tests. Keep the owner-only and
  already-published cases.

## Acceptance

- One `POST .../days/<slug>/publish` with `{}` and an owner token returns `200`
  and the day is on the site — no second call.
- A trip-scoped token still gets `403` with the "cannot publish them" message.
- Publishing an already-published day is still refused.
- `grep -n "confirmation" app/api/v1/\[user\]/trips/\[trip\]/days/\[slug\]/publish/route.ts`
  returns nothing.
- Deletion's confirmation is untouched: `test/deletions.test.ts` passes unchanged.
- All four checks pass.
