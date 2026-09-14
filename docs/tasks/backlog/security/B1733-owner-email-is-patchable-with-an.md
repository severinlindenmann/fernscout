---
id: B1733
title: owner.email is patchable with an owner token and no proof of the new address, and it is the address that mints owner tokens
type: SECURITY
priority: medium
complexity: medium
area: auth, journal document
found: "2026-09-14T12:03:19Z"
---

# B1733 — owner.email is patchable with an owner token and no proof of the new address, and it is the address that mints owner tokens

## Why

Raised by an audit of `config.json` round-tripping, which asked the question
rather than assuming the answer: **should changing the address that can mint
tokens require proving it first, the way `tel` does?**

What is true today, confirmed in the code rather than inferred:

- `owner.email` is in `journalPatch`'s writable properties
  (`/api/v2/openapi.json`), so an owner token can change it, with nothing sent
  to the new address.
- That field is what ownership *is*. `lib/api/auth.ts:119` resolves an owner by
  comparing the session's address against `getUser(username)?.owner.email`, and
  `agentScope` refuses a journal-wide write code for any other address —
  verified live: `[auth] write token refused for severin: a write code with no
  trip on it, for an address that is not the owner`.
- `owner.tel` is the opposite by design: it cannot be patched at all, and is
  set only by a verification round trip (`lib/ownerTel.ts`).

So the weaker field is the one that grants everything. A stolen seven-day agent
token is a seven-day problem; a stolen token plus one `PATCH` is permanent,
because the attacker's address can then mint fresh owner tokens for as long as
the journal exists, and the real owner's cannot.

**Not an escalation** — it takes an owner token to start with, and the audit
was explicit that the defences it probed (the `{name, nickname, email}`
sub-schema with `additionalProperties: false`, the refusal of `tel`,
`telProvenAt` and `telProvenMethod` on the wire) are sound and must not be
touched. This is about what one legitimate field means.

## Work

A decision for the owner, not for an agent. Two shapes, both coherent:

1. **Prove it, like `tel`.** `PATCH` with a new `owner.email` starts a
   verification instead of writing: a code goes to the new address, and the
   change lands when it comes back. Costs a round trip on a rare operation and
   makes the ownership record as strong as the telephone record.
2. **Leave it writable and say so.** Document that an owner token can move
   ownership, and treat token theft as the whole of the threat. Cheaper, and
   honest only if written down where somebody minting a token will read it.

Whichever is chosen, the other half is worth doing either way: **say in the
answer what changed.** A `PATCH` that moves `owner.email` should mail the old
address, the way a deletion does — a change nobody can undo should not be
silent to the person it takes the journal from.

## Acceptance

- Either a new address is proven before it becomes the owner, or the contract
  says plainly that an owner token can hand the journal to another address.
- The old address learns that it happened.
