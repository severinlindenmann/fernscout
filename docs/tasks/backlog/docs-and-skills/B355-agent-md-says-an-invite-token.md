---
id: B355
title: agent.md says an invite token is only stored hashed and can never be shown again, which B280 changed
type: DOCS
priority: medium
complexity: low
area: agent guide
found: "2026-09-04T19:57:27Z"
---

# B355 — agent.md says an invite token is only stored hashed and can never be shown again, which B280 changed

## Why

`agent.md`, on invite links:

> The token is in the response **once**. Only its hash is stored, so a link
> that is lost is reissued, never looked up.

Not true since B280 was fixed. `lib/contacts/invites.ts:211` writes
`token_cipher` beside `token_hash` — "Beside the hash, never instead of it" —
so an owner's contacts page can and does show the whole link again. Observed
2026-09-04 on fernscout.ch: the "Copy link" control on `/<user>/contacts`
returned the full `…/invite/buddy/fs_inv_…` URL for an invite created minutes
earlier through the API by a different process.

An agent working from the guide will tell an owner who mislaid a link that it
cannot be recovered and revoke-and-reissue is the only way — churning a link
that may already be in a group chat, to solve a problem the owner could have
solved by looking at their own page.

## Work

Replace the sentence. The token comes back once *in the API response*; the
owner's contacts page can show it again where the instance has a contacts key.
Keep the real rule that survives: do not store it anywhere the person did not
ask for.

## Acceptance

`agent.md` no longer says a lost invite link can only be reissued, and names
the contacts page as where the owner can see it again.
