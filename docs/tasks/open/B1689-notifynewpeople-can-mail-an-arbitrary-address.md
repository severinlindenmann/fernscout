---
id: B1689
title: notifyNewPeople can mail an arbitrary address on every trip write, unlimited
type: SECURITY
priority: low
complexity: low
area: rate limits, trips
found: "2026-09-13T20:06:01Z"
---

# B1689 — notifyNewPeople can mail an arbitrary address on every trip write, unlimited

## Why

Found while sweeping mail-sending paths for B1491.

`notifyNewPeople` (`lib/api/v2/trips.ts:112`) mails whoever appears in a
trip's `people:` after a `PUT`/`PATCH` to `/api/v2/<user>/trips/<trip>`, and
the route calling it (`app/api/v2/[user]/trips/[trip]/route.ts`) carries no
`rateLimitFor` anywhere on that path. `people:` is up to ten free-text
name+email pairs written by whoever holds write access to the trip — the
owner, or anyone on `people:` already, or an approved buddy — and each of
those ten is a real mail this server sends without the target having asked
for anything.

Unlike B1491's deletion mail, the address here is not fixed to the journal's
own owner: it is chosen anew by the caller on every write. Toggling a person
on and off `people:` across repeated writes could resend the same
"you've been added" or "come sign in" mail to the same outside address as
fast as the write endpoint allows, from a server that address has no
relationship with yet.

This is a bearer-authenticated write (the caller already holds write access
to the trip), not the unauthenticated/cookie-only shape B1491 was scoped to,
which is why it is a separate ticket rather than folded into that fix.

## Work

Give `notifyNewPeople`, or its caller, a `rateLimitFor` bucket keyed on the
outgoing address (so the limit tracks the mailbox being spammed regardless of
which write token is used) or on the trip (so it tracks abuse of one trip's
own write access) — whichever a person actually building this decides reads
truer against `lib/rateLimit.ts`'s existing per-address buckets
(`contact-resend`, `email-code-address`).

## Acceptance

- Repeated writes that keep re-adding the same non-owner address to
  `people:` stop sending a fresh mail to it once the bucket is spent.
- A test asserts the refusal (or the mail simply not going out again) rather
  than the limit's existence.
- `npm run verify` clean.
