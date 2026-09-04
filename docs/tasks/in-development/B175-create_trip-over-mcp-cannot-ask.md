---
id: B175
title: create_trip over MCP cannot ask for an unadvertised trip, because it has no listed field
type: ISSUE
priority: low
complexity: low
area: mcp, trips
found: "2026-09-03"
started: "2026-09-04T06:22:43Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:43Z"
---

# B175 — `create_trip` over MCP cannot ask for an unadvertised trip

## Why

The two doors disagree about one field. `POST /api/v1/<user>/trips` takes
`listed` in the body (`app/api/v1/[user]/trips/route.ts:117`), passes it to
`createTrip`, and `/openapi.json` documents it. The MCP tool of the same name
builds its `NewTrip` at `lib/mcp/tools.ts:874` and does not read `listed` at
all; its `inputSchema` (`lib/mcp/tools.ts:1092`) has `additionalProperties:
false`, so an agent that sends one is refused rather than quietly ignored — the
better of the two failures, but still a thing the REST caller can do and the
MCP caller cannot.

Since B51 that field means something: `listed: false` on a public trip is the
old `unlisted` — readable by anybody holding the link, in no sitemap, feed or
switcher. That is the honest setting for a trip somebody will mail to their
family, and an MCP-only agent cannot ask for it. The workaround is to create
the trip and then have a person edit `trip.md`, which is the advice B28 says has
nowhere to go.

Noticed while building B51, which made the key real everywhere else.

## Work

- Add `listed` to the `create_trip` input schema and pass it through in
  `createTripTool`, the way `visibility` already is.
- Say in the tool description what it does and that it only narrows —
  `createTrip` refuses `listed: true` on a trip no visibility advertises with
  `invalid_listed`, and the MCP handler should surface that message rather than
  a bare failure.

Not doing: any other field. B157 covers `test` on `create_day`, and the wider
question of which REST fields MCP is missing is worth its own sweep, not a
patch per field.

## Acceptance

- `create_trip` with `{"visibility": "public", "listed": false}` produces a
  trip that reads back `listed: false`, and the tool result says so.
- `create_trip` with `{"visibility": "private", "listed": true}` is refused
  with the `invalid_listed` message, not a generic error.
- A test in `test/mcp.test.ts` covers both.

## Built (2026-09-04)

`listed` is a boolean property of `create_trip`'s `inputSchema` and is passed
through the handler the way `test` is — only a real boolean counts, so a
non-boolean reads as "not asked for" rather than silently narrowing somebody's
trip. The refusal surfaces `createTrip`'s own `invalid_listed` message, which
teaches the axis instead of failing generically.

The reply also reads the value back **off the trip** rather than echoing the
argument, in the text and in `data`: an agent that asked for an unlisted trip
needs to see that it took, which is the whole reason for asking.

`test/mcp.test.ts` covers all three cases: `{public, listed: false}` writes a
`trip.md` byte-identical to the one REST writes for the same body; `{private,
listed: true}` is a tool error with no folder left behind; and an ordinary
public trip still writes no `listed:` line, because the key is written only when
it narrows.

**B206** is this finding rediscovered while B178 was being built. It is resolved
by this task and says so in its own file; it stays in `backlog/` rather than
being deleted, because an id means one thing forever.

Not done, as planned: any other field. B207 covers the four that are read and
unwritable, and is deliberately left alone.
