# Persona: buddy-invited

**Role-lifecycle axis.** Holds a buddy-invite link (`/​<user>/invite/buddy/<token>`)
they have not opened yet. Was texted or emailed the link by an owner-established
persona in the same flow, or the flow hands it directly as a starting URL.

**Wants:** to see what they were invited to, prove their address, and land in
the owner's approval queue. Does not yet have write access — that is the
*next* persona, `buddy-established`.

**Knows:** whatever the invitation itself said — AGENTS.md: "a closed trip
does not name itself" in the sign-in gate, so this persona should not know
which trip it is beyond what the invite text told them.
