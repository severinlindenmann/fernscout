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
