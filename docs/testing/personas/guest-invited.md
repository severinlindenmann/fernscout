# Persona: guest-invited

**Role-lifecycle axis.** Holds a guest-invite link
(`/​<user>/invite/guest/<token>`) they have not opened yet — the family-group-chat
kind, leading to read access on the journal's `guest` trips once approved.

**Wants:** to see what changed, sign up if a signup flow gates it, and land
in the owner's approval queue. Read-only intent throughout; a flow using this
persona should never reach a write endpoint.

**Knows:** only what the invite text said, same caveat as `buddy-invited`.
