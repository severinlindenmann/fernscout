---
id: B1069
title: There is no tool surface for an agent that would rather be guided than read a spec
type: FEATURE
priority: medium
complexity: medium
area: api, byoa, tools
found: "2026-09-09T07:11:57Z"
---

# B1069 — There is no tool surface for an agent that would rather be guided than read a spec

## Why

The brief describes three ways in, and two of them are the same one seen from
different distances: an agent that reads `/openapi.json` and decides for
itself, and an agent that would rather be handed a set of tools and guided.
The second is not a different capability — it is the same REST calls with a
shorter path to knowing which one to make.

This has been tried here and removed. `docs/plans/2026-09-04-remove-mcp.md`
deleted `/api/mcp` and its ten-odd tools with a specific complaint:
*"2,184 lines of tool definitions duplicating REST logic, 1,829 lines of
tests… overhead with no user right now."* `docs/ROADMAP.md:255` keeps the door
open: *"MCP may come back if a real client shows up."*

So the honest position is that the argument has changed in exactly one way —
there is now a stated user — and has not changed in the other: a tool layer
that *reimplements* REST will rot the same way it rotted before. If it comes
back, it comes back as a thin delegation with no logic of its own, or it does
not come back.

And there is a cheaper answer that should be tried first, because it addresses
the same complaint. **B311** — one guide of fifty-six kilobytes that an agent
fetches three times to write one day — is the actual reason an agent flounders
against this API. Path-scoped skill documents were the owner's own proposal
and are already the shape `.claude/skills/` uses locally. A well-scoped
document may be all "guided" ever needed to mean.

## Work

- Do B311 first, and then ask whether this ticket still has a subject. It may
  not, and that is the best outcome available here.
- If it does: a tool surface that holds no logic. Every tool is a call to a
  `/api/v1` route through the same functions the route uses, no validation of
  its own, no second vocabulary. The test that would have saved the last one:
  a tool that cannot be expressed as one documented route+verb does not get
  written.
- Authentication is solved and must be reused, not re-invented: `POST
  /api/v1/<user>/handover` mints a twenty-minute credential, `POST
  /api/auth/handover` spends it for a seven-day token, and `/<user>/me` lists
  and revokes what is live.
- Whatever is built is off by default like every other capability, and
  `/api/health` says why when it is off.

Not doing: reviving `lib/mcp/` from git. The removal plan was right about what
it removed; this would be a different, smaller thing that happens to speak the
same protocol.

## Acceptance

Either this file records that B311 made it unnecessary, or there is a tool
surface in which no tool contains a line of logic that is not also in a
documented route.
