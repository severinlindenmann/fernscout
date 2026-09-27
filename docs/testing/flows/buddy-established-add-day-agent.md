# Flow: buddy-established-add-day-agent

**Persona:** `buddy-established` (docs/testing/personas/buddy-established.md)
**Interface:** `api` — the bring-your-own-agent door (`/api/v2/**`), a bearer
token directly. **Not the in-studio assistant**: `app/api/helper/[user]/*` is
cookie-only, bound to `journal.owner.email`, and refuses every bearer token
outright — a buddy has no way into it today, by any credential. This flow
tests the door a buddy actually has.
**Capabilities exercised:** `auth`.
**Device/locale:** technical only — no UI is involved, this persona's whole
interaction is API calls.
**Check type:** technical (correct scope, correct draft, correct refusal at
the trip boundary and at the assistant's own boundary).

## Setup

1. Local dev server running.
2. A `test-buddy-established` journal seeded with one trip, and a
   trip-scoped agent token for the buddy persona: `POST /api/auth/codes` then
   `POST /api/auth/codes/redeem`, both with `"for": "write"` and
   `"scope": {"trip": "<trip-id>"}`, using an address on that trip's own
   `people` array.

## Steps

1. As the buddy, `PUT /api/v2/test-buddy-established/trips/<trip>/days/<slug>`
   (client-chosen slug, `YYYY-MM-DD-slug`) with what the persona actually
   said happened — "the pass we crossed today" — writing only what was told,
   no invented weather or feelings (AGENTS.md).
2. Confirm the day writes as a draft (`status: draft`, never published on
   create) and is scoped to the one trip the token covers — the same token
   against a second trip in the same journal must be refused.
3. `POST .../days/<slug>/publish` with the same token. Confirm it is
   refused — a trip-scoped token cannot publish: being on the bus is not the
   same as deciding what the journal says.
4. As a boundary check, not the main path: `GET /api/helper/test-buddy-established/ask`
   with the same bearer token. Confirm it is refused (`404 not_your_journal`)
   rather than silently succeeding — the assistant is cookie-only.

## Done when

- The draft day exists, scoped to the right trip, containing only what the
  persona said (technical check).
- The same token cannot write into a different trip in the same journal, and
  cannot publish (technical check).
- The in-studio assistant refuses the bearer token cleanly rather than
  accepting or half-accepting it (technical check).
