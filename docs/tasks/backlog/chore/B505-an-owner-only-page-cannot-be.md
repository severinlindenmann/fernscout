---
id: B505
title: An owner-only page cannot be opened on a local dev server
type: CHORE
priority: high
complexity: medium
area: dev experience, auth, mail
found: "2026-09-05T17:50:05Z"
---

# B505 — An owner-only page cannot be opened on a local dev server

## Why

B504 shipped a photobook composer that only the journal's owner can open, and
it shipped without anybody having seen it in a browser. Not for want of trying:
the page needs a session, `isOwner` has no development path, and local sign-in
did not complete.

What was tried, so the next person does not repeat it. `auth`, `credits` and
`photobook` were enabled in `content/config.json`; `contacts` was too, and the
boot refused until it was turned off again — correctly, for want of
`CONTACTS_ENCRYPTION_KEY`. `mail.transport: "file"` was enabled, migrations run
against a local SQLite file, and `POST /api/auth/request` answered `202`. No
`.eml` appeared under `content/example/mail/`, no `[mail]` line appeared in the
dev server's output, and `POST /api/auth/verify` therefore had nothing to
verify.

That last part is the actual bug, or the actual misunderstanding, and it is
worth finding out which. `FileTransport.send` in `lib/mail/index.ts` writes the
file *and* prints `[mail] … -> path`, precisely so a script waiting on a
one-time code can read it out of the terminal. Neither happened, while the
route answered as though it had. `app/api/auth/request/route.ts` is
deliberately uniform — every address-dependent outcome is a `202`, and its own
comments explain why — so the endpoint will not say which guard returned early.

The cost is not one afternoon. It is that every owner-only surface — the
composer, the contacts page, the postcard preview, the credits page — can only
be looked at on the live instance, by the one person signed in there.

## Work

Find out which guard returned early, or which transport call did not happen.
Instrument locally rather than by reading: the route will not tell you.

Then make the local path work and **write it down** — a short section in
`docs/`, or a script, taking somebody from a fresh clone to a signed-in owner
session against the demo journal.

**Not doing: a development bypass for `isOwner`.** The code flow is the only
way in and must stay so; an environment variable that makes somebody an owner
is a thing that eventually ships. What is wanted is the real flow working on a
machine with no mail account, which is what `mail.transport: "file"` already
promises and what `AGENTS.md` claims: "no feature needs a paid account to
develop or test".

If that promise turns out to be false rather than merely undocumented, that is
the finding, and fixing it is this ticket.

## Acceptance

- From a fresh clone, a documented sequence ends with a browser session that
  can open `/example/trips/parks-2025/photobook`.
- It uses the ordinary code flow. No new way to become an owner.
- The sequence is in `docs/`, not only in a commit message.
