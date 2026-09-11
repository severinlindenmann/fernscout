# Flow: guest-invited-signup-see-update

**Persona:** `guest-invited` (docs/testing/personas/guest-invited.md)
**Interface:** journal UI
**Capabilities exercised:** `signup`, `contacts`, `auth`
**Device/locale:** run at the requested viewport and in each locale the
seeded journal ships, to prove the sign-in gate and the guest trip list both
translate correctly.
**Check type:** graphical primarily (the sign-in gate, the approval-pending
state, the trip list once approved) with one technical check (the approval
row actually exists after the owner approves).

## Setup

1. Local dev server running with `features.contacts` and `features.auth` on
   (`CONTACTS_ENCRYPTION_KEY`, `SESSION_SECRET` set to any test values).
2. A `test-guest-invited` journal with an owner-established persona's
   session, and one `guest` trip.
3. An owner-issued guest-invite link (`POST /api/v1/test-guest-invited/invites`).

## Steps

1. Open the guest-invite link as the `guest-invited` persona. Confirm the
   sign-in gate names the journal only — never the trip
   (AGENTS.md: "a closed trip does not name itself").
2. Complete the identity/code flow. Confirm the persona lands in a
   pending-approval state, not on the trip itself.
3. As the owner-established persona (a second browser session), approve the
   contact.
4. As `guest-invited` (now effectively `guest-established`), reload and
   confirm the `guest` trip is now visible, and every other trip is not.
5. Repeat step 1-4's *visual* checks once per locale the journal ships.

## Done when

- The pending state and the approved state both render correctly at the
  requested viewport, in every locale checked (graphical check).
- After approval, exactly the trips marked `guest` are visible and nothing
  else (technical check, cross-referenced against the trip files' own
  `visibility` frontmatter).
