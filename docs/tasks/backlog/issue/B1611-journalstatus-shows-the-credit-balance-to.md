---
id: B1611
title: "journalStatus shows the credit balance to a trip-scoped token where v1 hid it"
type: ISSUE
priority: medium
complexity: low
area: API v2
found: 2026-09-12T00:00:00Z
---

## Why

`lib/api/v2/schemas/status.ts` declares `journalStatus.credits` as a required
integer with no null case, so `GET /api/v2/{user}/status` answers the
journal's real balance to **every** token that can reach it — including a
trip-scoped one held by a buddy.

v1 did not. `lib/api/status.ts` nulled the balance for a scoped token: being
on the bus does not mean seeing what the journal has spent. Nobody decided to
change that; it fell out of the schema being written with one shape for both
callers, and the route honouring the schema (which is the right instinct — see
`docs/v2-migration/06-contract-deltas.md`).

It is a small disclosure, not a hole: a buddy is already somebody the owner
invited onto a trip, and the number says nothing about who was paid or for
what. But it is money, it is the owner's, and the person seeing it is
explicitly *not* the owner — `AGENTS.md` keeps that line everywhere else
(`not_for_agents` on purchases, postcards owner-cookie-only, nothing a caller
holds raising a balance).

Found while building B1608. Not urgent: the instance is invite-only ALPHA and
there are no third-party buddies today.

## Work

The owner decides which of these is right; both are cheap.

- **Keep it.** A buddy sees the balance. Then say so deliberately in the
  schema's comment, so the next reader knows it was chosen rather than
  inherited.
- **Narrow it.** `credits` becomes nullable, null meaning "not yours to see",
  and the route nulls it for a scoped token exactly as v1 did. This is a
  change to a reviewed schema and needs a row in
  `docs/v2-migration/06-contract-deltas.md` — narrowing, with the reason
  being that the field's audience was never decided, not that v1 had it that
  way.

Not doing: a second status document for scoped tokens. One fact, one address.

## Acceptance

- A trip-scoped token calling `GET /api/v2/{user}/status` gets whatever the
  owner chose, and a test says which and why.
- If narrowed: `06-contract-deltas.md` carries the row.
