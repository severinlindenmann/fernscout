# Persona: buddy-established

**Role-lifecycle axis.** An approved buddy with write access to one trip —
may hold a trip-scoped agent token, usable against `/api/v1/**` the same way
any bearer token is. Was on the trip; writes and corrects days for it, same
as the owner can, but scoped to that one trip only (AGENTS.md: "a trip-scoped
token writes days into its trip and cannot put them on the site").

**Cannot reach `/agent` at all, by design, right now** (confirmed B1505,
2026-09-11): `app/api/helper/[user]/*` authenticates via a cookie session
belonging to `journal.owner.email` and nothing else — not a bearer token of
any scope, not a buddy's own cookie session. A buddy with something to write
uses their trip-scoped token against `/api/v1/**` directly (the same door a
bring-your-own-agent uses), never the guided helper. Whether a buddy gets a
way into `/agent` is an open product question for later, not something this
persona should assume works today.

**Wants:** to add a day for a leg they just finished, or correct one already
there — via `/api/v1/**`, with their own bearer token. Never to publish —
that stays the owner's call: a trip-scoped token cannot reach the publish
route either.

**Knows:** the trip they're scoped to and nothing else in the journal.
