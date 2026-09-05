---
id: B410
title: A reader's access is trapped in one journal's cookie, so the instance cannot tell them what they may open
type: FEATURE
priority: high
complexity: high
area: auth, sessions, identity
found: "2026-09-05"
related: B411, B412, B283, B33, B34
started: "2026-09-05T08:26:54Z"
merged: "2026-09-05T08:42:23Z"
---

# B410 — A reader's access is trapped in one journal's cookie, so the instance cannot tell them what they may open

## Why

There is exactly one guest cookie — `fs_session`, `lib/auth/index.ts:110` — and
the row it points at is bound to a single journal through `sessions.owner_id`.
Signing into journal B replaces the session for journal A. A person who is a
guest of one journal, a buddy on a trip in a second and the owner of a third
holds, at any moment, credentials for exactly one of them.

Two consequences, and the second is the expensive one:

- **The server cannot answer "what may this address open?"** Every resolver
  starts from a cookie that has already picked a journal — `journalReader`
  (`lib/contacts/session.ts:90`), `isOwner`, `resolveViewer`. There is no
  surface that could list somebody's journals because there is no query that
  could produce the list. B411 is blocked on this outright.
- **Being let in is per-device, not per-person.** An approved guest who opens
  the journal on a phone signs in again; on a laptop, again. The credential
  proves an address, but the proof is thrown away and re-obtained per journal
  per device.

Sessions are also unrevocable as a person: `listSessions(owner)` filters by
`owner_id`, so there is no way to see, let alone end, everything one address
holds across the instance.

## Work

A fifth `SessionKind`, `identity`, bound to an address and to no journal.

- `owner_id` takes the `"*"` sentinel `SIGNUP_OWNER` already uses. Rename that
  constant to `NO_JOURNAL` — two kinds share it now and the old name asserts
  something false about one of them.
- 365 days, `scope: "identity"`, and it authorises **nothing**. The property
  that makes this safe is the one B283 relied on: `lookUpSession` compares
  `kind` against what the caller asked for, and every read and write in the
  codebase asks for `"guest"` or `"agent"`. A new kind is refused everywhere by
  default and is let in deliberately, twice — the handshake, and B411's home
  endpoint.
- A **second cookie**, `fs_identity`. Not an overload of `fs_session`, which
  fourteen call sites already read for a different purpose.
- Migration `018`: `sessions.parent_id` (nullable), and a public opaque
  `identity_id` B412 can name a cache after without ever seeing a token.

How an address gets one:

- `POST /api/auth/identity/request` + `/verify` — the existing code machinery,
  30-minute TTL, five-attempt burn. With no mail account the code lands in
  `content/.mail/`, like a signup code: at that moment the address owns no
  journal.
- **And** on every existing successful sign-in — `/api/auth/verify`,
  `/api/auth/link`, `/api/contacts/confirm` — set `fs_identity` alongside
  `fs_session`. Proving the address for one journal does prove the address, and
  the identity grants nothing on its own. This is what makes the feature reach
  people who already read this site, with no new flow to discover.

The handshake, in `lib/auth/handshake.ts`:

- `resolveAccess(username)` returns the `fs_session` session when it belongs to
  *this* journal, and otherwise derives the role straight from `fs_identity` —
  owner (`config.json` `owner.email`), traveller/buddy (`isPersonOnWith` +
  `redeemedTripsFor`), guest (active contact + `hasReadGrant`), or nothing.
  Wrapped in `cache()` like `resolveSession`. The page is right on the **first**
  request; there is no reload and no flash.
- **No derived per-journal session, and that changed during the build.** The
  plan was for the handshake to mint a `guest` session, keep `parent_id` so
  revocation could cascade, and add `POST /api/auth/handshake` plus a client
  component to materialise it. It earns nothing: every gate re-derives access
  from the address on each request anyway, so the minted session saved no
  lookup — one indexed `sessions` query either way — and existed only to create
  rows a revocation then had to chase. Dropping it removes `parent_id`, the
  cascade, a route and a component, and makes revocation absolute: an identity
  has nothing downstream of it to outlive it.
- **Role, never write power.** Nothing here mints anything an owner can write
  with. `isOwner()` still decides every write, per call, from the address.
  Decision 24 is untouched and this task must not touch it.
- Every gate that read `fs_session` directly now asks `resolveAccess`:
  `journalReader`, `isOwner`, `isTravellerOn`, `listableTrips`, the journal
  layout's `signedIn` flag and `/api/push/subscribe`. A gate left reading the
  cookie would silently refuse everyone who arrived by identity.

**Not** in this task: the handshake in `proxy.ts`. Next's own documentation
says proxy runs on every route including prefetches and must not do database
work (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md:29`).

## Acceptance

- An identity token presented as `fs_session`, as a bearer token, or on any
  content route is refused — a test asserting it in every direction, as
  `test/session-cache.test.ts` does for guest/agent.
- Signing in to journal A and then opening journal B resolves the right role in
  B without a second code.
- Revoking an identity ends every journal session it minted, on the next
  request.
- An address with no role in a journal resolves to nothing, and that journal's
  gate behaves exactly as it does today.
- `npm run verify` green; the dev server boots with contacts on and off.
