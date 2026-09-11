# Flow: buddy-established-add-day-agent

**Persona:** `buddy-established` (docs/testing/personas/buddy-established.md)
**Interface:** `api` — the bring-your-own-agent door (`/api/v1/**`), a bearer
token directly. **Not `/agent`**: confirmed live (B1505, 2026-09-11) that
`app/api/helper/[user]/*` is cookie-only, bound to `journal.owner.email`, and
refuses every bearer token outright — a buddy has no way into `/agent` today,
by any credential. This flow tests the door a buddy actually has.
**Capabilities exercised:** `auth`.
**Device/locale:** technical only — no UI is involved, this persona's whole
interaction is API calls.
**Check type:** technical (correct scope, correct draft, correct refusal at
the trip boundary and at the `/agent` boundary).

## Setup

1. Local dev server running.
2. A `test-buddy-established` journal seeded with one trip and a
   trip-scoped agent token for the buddy persona (`get-token.sh` against the
   local server, scoped to that trip).

## Steps

1. As the buddy, `POST /api/v1/test-buddy-established/trips/<trip>/days`
   with what the persona actually said happened — "the pass we crossed
   today" — writing only what was told, no invented weather or feelings
   (AGENTS.md).
2. Confirm the day writes as a draft (`status: draft`, never published on
   create) and is scoped to the one trip the token covers — the same token
   against a second trip in the same journal must be refused.
3. `POST .../days/<slug>/publish` with the same token. Confirm it is
   refused — a trip-scoped token cannot publish (AGENTS.md: "being on the
   bus is not the same as deciding what the journal says").
4. As a boundary check, not the main path: `GET /api/helper/test-buddy-established/ask`
   with the same bearer token. Confirm it is refused (`404 not_your_journal`
   today) rather than silently succeeding — this is the documented current
   behavior (B1505), not a bug this flow should treat as a failure.

## Done when

- The draft day exists, scoped to the right trip, containing only what the
  persona said (technical check).
- The same token cannot write into a different trip in the same journal, and
  cannot publish (technical check).
- `/agent` refuses the bearer token cleanly rather than accepting or
  half-accepting it (technical check, documents current behavior — see
  B1505 for whether this should change).
