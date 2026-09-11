---
id: B1491
title: The deletion mail has no rate limit on any of its three callers
type: SECURITY
priority: medium
complexity: low
area: deletions, mail, rate limits
found: "2026-09-11T16:59:52Z"
---

# B1491 — The deletion mail has no rate limit on any of its three callers

## Why

Found while building B1295, which needed a rate limit and went looking for the
one to match.

`requestDeletion` mails a single-use link to the address that owns a journal.
Its three callers — `DELETE /api/v1/<user>`, the trip delete route, and
`/<user>/me/delete` — make **no `rateLimitFor` call anywhere in that path**.

So a caller who can reach any of those can make this instance send mail to an
owner's address as fast as it will go. The link itself is safe — it is
single-use, hashed, hour-limited, and pressing it is the only thing that deletes
— so this is not a way to delete somebody's journal. It is a way to fill their
inbox with letters about deleting it, from a server they trust, which is its own
kind of harm and is indistinguishable from the real thing at the moment it
arrives.

B1295's own new route did not inherit the gap: it borrowed the shape of
`contact-resend` (`app/api/contacts/admin/route.ts`, max 3 per hour) rather than
copying a neighbour that had none.

## Work

Give `requestDeletion`'s callers a limit, and take the number from something
that already exists rather than inventing one — `contact-resend`'s 3-per-hour is
the nearest analogous action, and B1295 now uses it for `export-request`.

Check the other mail-sending paths in the same sweep. The question is not "does
this one have a limit" but **which mail a stranger can make this server send**,
and the answer should be written down once.

Note while there: `auth-request` and its siblings are limited
(`get-a-credential` documents the buckets), so the pattern exists and this path
simply missed it.

## Acceptance

- None of `requestDeletion`'s callers will send a second mail to the same
  address inside the window.
- A test asserts the refusal rather than the limit's existence.
- Every path that sends mail on an unauthenticated or cookie-only request is
  named in one place, with its bucket.
- `npm run verify` clean.
