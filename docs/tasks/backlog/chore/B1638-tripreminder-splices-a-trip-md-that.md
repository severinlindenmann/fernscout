---
id: B1638
title: "tripReminder splices a trip.md that new trips no longer have"
type: CHORE
priority: medium
complexity: low
area: API v2
found: 2026-09-13T00:00:00Z
---

## Why

`lib/api/tripReminder.ts` still edits `trip.md` through
`spliceBlock`/`spliceScalar` (`lib/frontmatterScalar.ts`). Since B1598's
writer flip, `createTrip` writes `trip.json` and no new trip has a `trip.md`
at all — so this route writes into a file that does not exist.

It was already half-dead before that: the branch's own notes record that
`reminder` has no v2 read-side home (`reminder: undefined` always), so nothing
rendered what it wrote. Now it is unreachable on the write side too.

`lib/frontmatterScalar.ts` survives only because this one caller keeps it
alive; retiring this retires that as well, which is the last of v1's
hand-rolled YAML splicing.

## Work

Decide whether the reminder feature is coming back:

- **If yes** — it needs a field in the v2 trip schema (a D row, the owner's
  word) and this route rewritten over `readTripJson`/`writeTripJson` like the
  other patchers.
- **If no** — delete the route, `lib/api/tripReminder.ts`, and
  `lib/frontmatterScalar.ts` with it, and say so in the ticket so the next
  person does not rebuild it from the leftovers.

Not doing: leaving it writing into a file nothing creates. That is the state
that makes somebody trust a green call.

## Acceptance

- Either the reminder round-trips through `trip.json` and renders, or the
  route and its module are gone.
- `knip` is clean afterwards — no orphaned `frontmatterScalar`.
