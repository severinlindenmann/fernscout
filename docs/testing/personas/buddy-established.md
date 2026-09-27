# Persona: buddy-established

**Role-lifecycle axis.** An approved buddy with write access to one trip —
may hold a trip-scoped agent token, usable against `/api/v2/**` the same way
any bearer token is. Was on the trip; writes and corrects days for it, same
as the owner can, but scoped to that one trip only: a trip-scoped token
writes days into its trip and cannot reach the publish route (see
`lib/api/auth.ts`'s `mayWriteTrip`/`refuseWrite`).

**Cannot reach the in-studio assistant (`app/api/helper/[user]/*`) at all**:
it authenticates via a cookie session belonging to `journal.owner.email` and
nothing else — not a bearer token of any scope, not a buddy's own cookie
session. A buddy with something to write uses their trip-scoped token against
`/api/v2/**` directly (the same door a bring-your-own-agent uses), never the
assistant. Whether a buddy gets a way into the assistant is an open product
question for later, not something this persona should assume works today.

**Wants:** to add a day for a leg they just finished, or correct one already
there — via `/api/v2/**`, with their own bearer token. Never to publish —
that stays the owner's call: a trip-scoped token cannot reach the publish
route either.

**Knows:** the trip they're scoped to and nothing else in the journal.
