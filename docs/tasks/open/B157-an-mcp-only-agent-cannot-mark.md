---
id: B157
title: An MCP-only agent cannot mark a single day as test content, because create_day has no test field
type: ISSUE
priority: high
complexity: low
area: mcp, test-content
found: "2026-09-03"
---

# B157 — MCP cannot flag one day as test content

## Why

Found while verifying B28. MCP's `create_day` has **no `test` property in its
schema**, so an agent working through MCP cannot mark an individual day as
content nobody lived. Its only option is for the whole trip to carry the flag.

`AGENTS.md` is unusually firm about what that flag is for:

> **`test: true`** is the exception, and the only one. A day or a trip carrying
> it is content nobody lived, written to prove the pipeline works … Writing
> "this is a test" into the prose instead is a convention, not a guarantee —
> the next reader has no way to know whether you bothered.

So the guarantee is offered to every agent, and one of the two doors cannot
honour it. An MCP agent asked to invent a single day inside a real trip — to
demonstrate something, to check a rendering — has exactly the fallback
`AGENTS.md` names and rejects: writing "this is a test" into the prose.

The REST door takes `test` on both the trip and the day. B47 verified the whole
read side works, including a day *inheriting* the flag from its trip. The gap
is only in what MCP lets an agent write.

Related and separate: `create_day` declares `additionalProperties: false` and
then silently accepted an unknown `status` argument rather than rejecting the
call. It ignored it and produced a draft, so nothing unsafe happened — but a
schema that says it refuses unknown properties and does not is a bad promise
to hand an agent, and it is why sending `test` today fails quietly rather than
loudly. Worth fixing in the same change.

## Work

- Add `test` to `create_day`'s input schema, matching the REST field: boolean,
  optional, `true` means this day did not happen.
- Make `additionalProperties: false` mean what it says, so an argument the
  schema does not know is refused rather than dropped. An agent that mistypes
  `test` should be told.
- Check `create_trip` over MCP for the same gap while in there.
- One test per door asserting the same day written through REST and through
  MCP ends up with the same frontmatter.

## Acceptance

- An MCP agent can write a single `test: true` day into a trip that is not
  itself flagged, and read the flag back.
- An unknown property sent to `create_day` is refused, not ignored.
- The two doors produce identical frontmatter for identical input.
