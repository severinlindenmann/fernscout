---
id: B1492
title: An owner signed in on their journal is asked to sign in again at /agent
type: ISSUE
priority: high
complexity: low
area: auth, agent
found: "2026-09-11T17:16:29Z"
started: "2026-09-11T17:17:26Z"
session: 91372f16-ef09-459f-9b81-4dec4accbb1e
claimed: "2026-09-11T17:17:26Z"
---

# B1492 — An owner signed in on their journal is asked to sign in again at /agent

## Why

Reported from the live instance: signed in as the owner on
`/severin/trips`, clicking through to `/agent` shows the door asking for a
six-digit code. The journal's own `config.json` names the same address the
person signed in with, so this is not B480's operator-versus-owner case.

The two pages ask different questions of the browser. `app/[user]/layout.tsx`
asks `resolveAccess(username)`, which accepts **either** credential —
`fs_session` for this journal or the instance-wide `fs_identity`
(`lib/auth/handshake.ts:76-92`). `app/agent/page.tsx:107` asks
`resolveIdentity()`, which is deliberately satisfiable by the identity cookie
alone and by nothing else, for the reason written out in `handshake.ts:99-107`.
A browser holding only `fs_session` is therefore fully signed in on the journal
and a stranger at `/agent` — and `AgentDoor` is handed `signedIn={Boolean(identity)}`,
so it shows the sign-in form rather than "signed in as …".

B459 already built the cure for such a browser: `POST
/api/auth/identity/upgrade` mints the identity a live journal session has
earned. What it did not do is mount it anywhere but the journal:
`components/IdentityUpgrade.tsx` is rendered at `app/[user]/layout.tsx:161`
and nowhere else. So every identity-only surface outside `/[user]/` — `/agent`,
and `/`'s journal list via `/api/v1/me/home` — is closed to that reader until
they happen to load a journal page *and* let its client effect finish. Arriving
at `/agent` from a bookmark, a pasted link, the installed PWA, or quickly
enough after the journal page that the upgrade POST has not landed, all give
the same dead end.

It costs the most for the reader least able to work around it: the helper is
the only way a non-technical owner writes a day, and what they are shown is a
demand for a code in a mailbox.

## Work

Mount the upgrade where the door is: `app/agent/page.tsx` renders
`<IdentityUpgrade />` when `resolveIdentity()` came back null **and** the
request carries a journal cookie. The page is already `force-dynamic` and
already reads `cookies()`, so this costs nothing, and the cookie condition
keeps a stranger at the door from firing a POST they cannot satisfy.

Not doing: moving the upgrade into the root layout. It would fix `/` in the
same stroke and force every public page — the landing page included — to
render dynamically, which is a price this bug does not justify. `/`'s own
gap is captured separately as B1493.

Not doing: loosening `resolveIdentity` to accept `fs_session`. `handshake.ts`
is explicit about why it must not, and the mint is a different act from the
answer.

## Acceptance

- Sign in as an owner locally, delete the `fs_identity` cookie, and open
  `/agent` directly: the room appears (after one upgrade round-trip), not the
  code form.
- A signed-out browser opening `/agent` fires no request to
  `/api/auth/identity/upgrade`.
- `npm run verify` green.
