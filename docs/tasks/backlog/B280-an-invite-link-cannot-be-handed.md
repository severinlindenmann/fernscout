---
id: B280
title: An invite link cannot be handed out a second time, because the token is only stored hashed
type: SECURITY
priority: medium
complexity: medium
area: contacts, invites, db, crypto
found: "2026-09-04T12:40:00Z"
---

# B280 — An invite link cannot be handed out a second time, because the token is only stored hashed

## Why

`createInvite` (`lib/contacts/invites.ts:142`) returns the token once and stores
only `hashSecret(token)`. The reasoning is written at `lib/contacts/invites.ts:61`
— "the token is stored hashed, like every other bearer credential here" — so
once the owner closes the page, the URL is gone. The only actions left on a row
are revoke and read the counters.

In practice that means a new link every time. The owner wants to send the family
link to one more cousin, cannot, and issues a second link for the same audience;
the list grows a row per cousin, each with a note to re-type, and revoking the
right one later is guesswork. B97 is the same failure one step earlier — two
rows the owner could not tell apart, one of which led to write access.

**The author has asked for the link to be re-copyable, after being told what it
costs, and that decision stands.** What follows is how to spend as little of it
as possible.

### What it costs, stated plainly

A recoverable invite token is a live credential at rest. Today a database dump,
a stray backup or a read-only SQL injection yields hashes and no way in; after
this, it yields working links to somebody's journal. The mitigation is not to
argue with the decision but to keep the plaintext out of the database:

**Encrypt it, do not store it plainly.** `lib/contacts/crypto.ts` already does
exactly this job for postal addresses — AES-256-GCM, key from
`CONTACTS_ENCRYPTION_KEY`, environment only, with an AAD binding the ciphertext
to its row (`addressAad(owner, contactId)`, `lib/contacts/crypto.ts:110`). And
`contacts` already requires that key (`lib/capabilities.ts:18`), so invites —
which live inside the contacts capability — have it available with no new
configuration. A dump then yields ciphertext, and reading it needs the
environment as well as the database, which is the property the hash was buying.

Keep the hash column too. Redemption looks up by hash and must not start
decrypting every row to find a match, and the hash is what makes a
constant-time comparison possible.

## Work

- **Migration** adding an encrypted-token column to the invites table. Existing
  rows have no plaintext to recover and never will: they keep working for
  redemption and their copy action is simply absent. Do not backfill, and do not
  invalidate them.
- **`createInvite`** stores the ciphertext alongside the hash, with an
  `inviteAad(owner, inviteId)` in the shape `addressAad` already uses.
- **A read path for the owner and nobody else.** The decryption happens in the
  same place `ContactsAdmin`'s postal addresses are decrypted — server-side, on
  a page already behind `isOwner`, and never in a list endpoint that anything
  else calls. `app/[user]/contacts/page.tsx:62` carries the comment for the
  address version of this rule; follow it.
- **`listInvites` stays as it is.** The plaintext must not appear in
  `GET /api/v1/<user>/invites` merely because a token could read it — that
  endpoint answers to an agent bearer token, and an agent that can list invites
  does not need to be able to re-send them. If it is ever wanted there, that is
  a separate decision with its own task.
- **`CONTACTS_ENCRYPTION_KEY` absent** must degrade to today's behaviour — no
  copy action — rather than to an unencrypted write or a 500.

Not doing: making the invite token recoverable for `personal` links (B281 is
removing that kind from the UI), and not touching how agent tokens or sign-in
codes are stored. Those are the credentials decision 24 is about and they stay
hashed.

## Acceptance

- An invite created before this task can still be redeemed, and its row offers
  no copy action.
- An invite created after it can be copied from the contacts page any number of
  times, and the copied URL redeems.
- The stored value is not the token: `sqlite3 … 'select * from invites'` shows
  ciphertext, and the same row with `CONTACTS_ENCRYPTION_KEY` unset yields no
  plaintext and no crash.
- `GET /api/v1/<user>/invites` with an agent token returns no token field.
- A test asserts the AAD binds the ciphertext to its row — the ciphertext from
  one invite fails to decrypt under another invite's id.
- `claude-security` has been run over the branch; every finding is fixed or
  captured by id.
- The four checks pass.
