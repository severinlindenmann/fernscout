---
id: B157
title: An MCP-only agent cannot mark a single day as test content, because create_day has no test field
type: ISSUE
priority: high
complexity: low
area: mcp, test-content
found: "2026-09-03"
started: "2026-09-03T19:34:18Z"
merged: "2026-09-03T19:42:11Z"
completed: "2026-09-04T05:32:26Z"
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

## What building it found

`create_trip` had the same gap, as the ticket suspected — fixed in the same
change. Both `createDraft` (`lib/api/entries.ts:65`) and `createTrip`
(`lib/tripWrite.ts:48`) already accepted `test` and already wrote it only when
true. Nothing below the door was missing; the door simply never passed it on
and never declared it.

The `additionalProperties: false` half turned out to be the more interesting
one, and it is *why* the first half failed quietly rather than loudly. Nothing
enforced it anywhere — `callTool` (`lib/mcp/tools.ts`) handed `args` straight
to the handler — so every schema in the file was making a promise none of them
kept. Enforcement is now one function against the tool's own declared
properties, so it holds for all fifteen tools rather than for `create_day`
alone.

Running the full suite with enforcement on found **no** handler that had been
relying on an undeclared argument, which is the risk that made this worth
checking before shipping rather than after.

One test changed meaning: "a `status` argument is not a way in" previously
asserted only that no day was published. It now also asserts the call is
refused. The guarantee it guards is unchanged — nothing publishes — but an
agent that mistypes now learns it, instead of being told it succeeded.

## Acceptance

- An MCP agent can write a single `test: true` day into a trip that is not
  itself flagged, and read the flag back.
  **Met** — "one day can be marked as content nobody lived, inside a trip that
  is real", which also asserts the trip itself stays unflagged. Fails before
  the change with `expected '---\ntitle: "Lanterns of Hoi An"…' to contain
  'test: true'`. A companion test pins that an ordinary day carries no `test:`
  line at all.
- An unknown property sent to `create_day` is refused, not ignored.
  **Met** — "an unknown property is refused, not ignored" sends `tset: true`,
  expects the refusal to name it, and asserts no file was written.
- The two doors produce identical frontmatter for identical input.
  **Met** — "REST and MCP write identical frontmatter for the same test day"
  writes the same day through both and compares the files byte for byte. This
  is the one that fails most usefully against the old code.
- `create_trip` checked for the same gap — it had it, and now takes `test` too.

Verified with all four: `npx tsc --noEmit`, `npx eslint .` (0 errors),
`npx vitest run` (1804 passed, 2 skipped), `npm run build`.
