# Flow: guest-established-react-to-day

**Persona:** `guest-established` (docs/testing/personas/guest-established.md)
**Interface:** journal UI
**Capabilities exercised:** `reactions`
**Device/locale:** run at the requested viewport; reactions are a reader
surface, so this is a good flow to check in every locale the journal ships.
**Check type:** technical (`app/api/reactions/route.ts`'s own guarantees:
gated exactly like a read, an anonymous voter id) and graphical (the reaction
control on a published day, before and after the tap).

## Setup

1. Local dev server running with `features.reactions` on for a
   `test-guest-established` journal (`reactions: { enabled: true }` is
   already the shipped default — AGENTS.md — so this only needs *not* turning
   it off).
2. A `guest` trip in that journal with at least one published day, and the
   `guest-established` persona already approved as a contact (`guest` trips
   are the ones this persona is let into — its own persona file).

## Steps

1. As `guest-established`, open the published day. Confirm the reaction
   control renders with the counts `GET /api/reactions?trip=…` reports.
2. Leave a reaction. Confirm the tap goes through
   `POST /api/reactions` — the app's own client, `ReactionsProvider`, sends
   the trip ref and the browser's own random voter id from `localStorage`,
   never anything that identifies the person by name or contact.
3. Reload the page. Confirm the count now includes this reaction and the
   persona's own pick is remembered (same voter id, same trip).
4. As an unrelated, unauthenticated caller (a fresh browser context with no
   cookie), request `GET /api/reactions?trip=<the same private-adjacent
   trip>` for a trip this persona cannot read. Confirm it answers
   `400 unknown_trip` — the same body a trip that does not exist would give
   (AGENTS.md/B117's own rule about a closed trip not naming itself, applied
   here to the reactions endpoint specifically, per the route's own module
   comment about "an existence oracle").

## Done when

- The reaction is recorded and persists across a reload, scoped to the one
  trip and the one anonymous voter id (technical check).
- A trip this reader may not see answers the reactions endpoint identically
  to a trip that does not exist — no distinguishing status or message
  (technical check, the route's own stated property).
- The reaction control renders correctly, before and after voting, at the
  requested viewport (graphical check).
