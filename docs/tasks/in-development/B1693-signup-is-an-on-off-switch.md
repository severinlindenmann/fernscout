---
id: B1693
title: Signup is an on/off switch, so an instance cannot be open to a named few
type: FEATURE
priority: medium
complexity: medium
area: auth, signup, admin, config
found: "2026-09-14T05:19:42Z"
started: "2026-09-14T05:20:23Z"
session: b09bcb65-1165-4e8c-8548-2f5634561c64
claimed: "2026-09-14T05:20:23Z"
---

# B1693 — Signup is an on/off switch, so an instance cannot be open to a named few

## Why

`features.signup.enabled` is a single boolean: this instance takes anybody, or
it takes nobody. `lib/capabilities.ts:355` gates it, and every door reads the
same switch — `app/api/auth/codes/route.ts:82` and `:61` for the email code,
`app/api/auth/signup/phone/route.ts:52` and `.../redeem/route.ts:22` for the
phone step, `lib/whatsapp/onboarding.ts:203` for the WhatsApp door.

An operator running a private instance has no third state. They want the
people they have invited to be able to make a journal, and nobody else — so
today they either leave signup off and create journals by hand, or leave it on
and take whoever finds the domain.

## Work

Decided with the owner on 2026-09-14:

- **`features.signup.enabled` goes away; `features.signup.inviteOnly` replaces
  it, defaulting to `true`.** Signup is no longer a switchable capability — it
  is always available, narrowed by the list. The block stays (it carries
  `phoneBackend`). An operator setting `inviteOnly: false` opens the instance
  to anybody, which is today's `enabled: true`.
- **A new DB table holds the allowed addresses**, with a migration (next free
  number — see B1146; check the highest on disk at branch time). Entries are
  **permanent until an operator removes one**: a signup that dies half-way can
  be restarted without asking for the address to be re-added.
- **`/admin` grows a panel to add and remove an address**, operator-only like
  the rest of that page. Nothing personal in fixtures.
- **Every door checks the list, not just the email one.** The codes route, the
  two phone routes and `lib/whatsapp/onboarding.ts`. An address that is not
  listed is never issued a signup code by any path — that is the whole control,
  so a missed door is the bug this ticket is about.
- **The refusal says plainly that the instance is invite-only** and to ask the
  operator; a new error code beside `signup_disabled` in `lib/api/errorCodes.ts`.
  Not a silent fake success — somebody who mistyped their address must not sit
  waiting for a mail that will never come.
- **A listed address still does the entire normal signup** — email code, phone
  number, phone verification, credit grant. Being on the list only earns the
  right to be sent the first code. No shortcut, no pre-verified state.
- **An existing `enabled: false` becomes invite-only with an empty list**,
  which is the same practical effect as today's off. `/api/health` stops
  reporting `signup` as a capability that can be off; say in its explanation
  whether the instance is invite-only.
- Contract: `/api/v2/openapi.json` and the `for: "signup"` prose in
  `lib/api/openapi.ts` and `lib/api/skillDocs.ts` must stop describing a
  signup that can be disabled. Run `keep-the-contract`.
- UI strings need real English, German and Hungarian entries; `npm run i18n:keys`.

Not in scope: invite *links* (B1690 and the invite routes are a different
thing — that flow adds somebody to an existing journal). No bulk import, no
expiry on an entry, no self-service request-an-invite form.

## Acceptance

- `site/config.json` with no `features.signup` block at all: a fresh instance
  is invite-only, and a signup attempt from an unlisted address is refused with
  the invite-only reason at every door — codes, phone, phone/redeem, WhatsApp.
- An address added in `/admin` can complete signup end to end locally with the
  dry-run mail and `phoneBackend: "dry-run"`: code, phone number, phone code,
  journal created. Verified in a browser at desktop and phone width, not only
  by the suite.
- Removing the address in `/admin` refuses the next attempt again; the journal
  already created is untouched.
- `inviteOnly: false` lets an address that is not listed sign up.
- `npm run verify` passes, including `test/depersonalised.test.ts`, and the
  contract audit is clean.
