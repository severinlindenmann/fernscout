---
id: B228
title: The guest list issues a link that never expires
type: ISSUE
priority: medium
complexity: low
area: contacts, access
found: "2026-09-04T07:49:53Z"
completed: "2026-09-05T17:13:16Z"
---

# B228 — The guest list issues a link that never expires

## Why

> **Fixed by B281, verified 2026-09-05.** The route this task is about is
> gone: `case "invite"` was removed from `app/api/contacts/admin/route.ts`
> (the comment where it stood says so), and the panel now posts to
> `POST /api/v1/{user}/invites`, "which always dates the link". Both remaining
> callers of `createInvite` pass an `expiresAt` — the API route via
> `inviteExpiry(days)`, the admin route's `case "create"` via
> `inviteExpiry()`. No door issues an undated link any more.
>
> The second Work item — what happens to `personal` links already issued with
> `expires_at = null` — was left, which this task allowed for: "leaving them
> and letting the list show 'no end date' may be the honest answer".

`lib/contacts/invites.ts` says it in as many words: thirty days by default,
`null` — never expires — "is deliberately not something this offers, because
'both still need an expiry and a revoke' is the point of leaving the shared
password behind". Every door honours that. `POST /api/v1/{user}/invites` passes
`expiresAt: inviteExpiry(days)` and comments that a link which never expires is
the shared password again wearing a URL.

The guest list does not. `app/api/contacts/admin/route.ts`, `case "invite"`,
calls `createInvite` with a name and a locale and no `expiresAt` at all, so
every personal link the owner issues from `/{user}/contacts` — the form headed
"New personal link", which is the one an ordinary owner actually uses — is live
until somebody remembers to revoke it by hand.

Invisible until now, which is why it has stood: the row rendered as
`name · language · used 0×` and said nothing about an expiry either way. B97
made the state legible, and the personal links on that page read **"no end
date"** while the two B33 kinds beside them read "works until <date>".

The cost is the one the module set out to avoid. A personal link is mailed to a
person, and the message sits in their inbox; two Christmases later it is still
a way of asking to be let in, and the only defence is an owner scrolling a list
looking for links they no longer recognise.

## Work

- Date the link the admin route issues, the way both other doors do. The
  default (`INVITE_TTL_DAYS`) is the obvious answer; whether the form should
  offer the owner a choice is a separate question and probably a no.
- Decide what happens to the links already issued with `expires_at = null`.
  Backfilling somebody's live invitation is a decision, not a migration to make
  quietly — leaving them and letting the list show "no end date" may be the
  honest answer.

Not doing: anything about what a link grants, and not touching guest or buddy
links, which are already dated.

## Acceptance

- A link created through `POST /api/contacts/admin` with `action: "invite"`
  comes back with a non-null `expiresAt`, and the guest list shows a date
  rather than "no end date".
- A test that fails now, beside the ones B97 added in
  `test/guest-list-links.test.tsx`.
