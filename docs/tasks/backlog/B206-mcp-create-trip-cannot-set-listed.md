---
id: B206
title: MCP create_trip cannot set listed, so the two doors do not accept the same trip
type: ISSUE
priority: low
complexity: low
area: trips, api, mcp
found: "2026-09-04T06:14:09Z"
---

# B206 — MCP create_trip cannot set listed, so the two doors do not accept the same trip

## Why

Noticed while adding `costsVisibility` to both doors for B178, which required
checking that they accept the same body.

`POST /api/v1/<user>/trips` takes `listed` (`app/api/v1/[user]/trips/route.ts`)
and passes it to `createTrip`, which writes `listed: false` when the caller
narrows a public trip and refuses `listed: true` on a trip no visibility
advertises. MCP `create_trip` does not have the property in its `inputSchema`
at all (`lib/mcp/tools.ts`), and its handler never reads one.

So the two doors are not the same content behind two doors for this field: an
agent working over MCP cannot create the setting AGENTS.md calls "the old
`unlisted`" — public, readable by anybody holding the link, advertised
nowhere. That is the honest setting for a trip somebody will mail to their
family, and over MCP the only way to it is to create the trip and then edit
`trip.md` by hand, which is the thing this product says nobody has to do.

Same shape as B178, one field over, and worth doing in the same place.

## Work

- Add `listed` to `create_trip`'s `inputSchema` as a boolean, with the
  description saying it only ever narrows, and pass it through the handler the
  way `test` is passed.
- Extend the "REST and MCP write identical frontmatter" test in
  `test/mcp.test.ts` to cover `listed: false` on a public trip.

Not doing: any change to the parser or to what `listed:` means. B51 settled
that and this is only about a door that cannot ask for it.

## Acceptance

- `create_trip` with `{"visibility": "public", "listed": false}` writes a
  `trip.md` byte-identical to the one REST writes for the same body.
- `create_trip` with `listed: true` on a private trip is a tool error, not a
  written trip — the same refusal REST gives.
