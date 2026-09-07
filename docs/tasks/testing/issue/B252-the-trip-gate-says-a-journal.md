---
id: B252
title: The trip gate says a journal has no sign-in while /api/auth still issues it sessions
type: ISSUE
priority: medium
complexity: low
area: auth, capabilities
found: "2026-09-04T09:53:52Z"
started: "2026-09-07T10:37:41Z"
merged: "2026-09-07T11:08:37Z"
---

# B252 — The trip gate says a journal has no sign-in while /api/auth still issues it sessions

## Why

`auth` is an opt-in capability, and two places ask whether it is on for a
journal with two different questions:

- `app/[user]/trips/[trip]/layout.tsx:62` — `canSignIn={isEnabled("auth", user)}`,
  which fails on a journal whose own `config.json` never mentions `auth`
  (`resolveOne` in lib/capabilities.ts: "not enabled by `<user>`").
- `app/api/auth/request/route.ts:38` and `app/api/auth/verify/route.ts:28` —
  `isEnabled("auth")`, the **server's** answer, with no username at all.

Observed on a production build of this repository, with
`features.auth.enabled: true` in `content/config.json` and nothing about auth
in `content/example/config.json`:

```
$ curl -s localhost:3700/example/trips/alps-2024        # a private trip
<h1>Fernscout Demo</h1> … "This trip is not public. Ask whoever writes this
journal to send you a link."          # gate.askOwner — no form offered

$ curl -X POST localhost:3700/api/auth/request -d '{"user":"example",…,"kind":"guest"}'
202                                    # and a code is written to that journal's mail

$ curl -X POST localhost:3700/api/auth/verify  -d '{…,"code":"123456","kind":"guest"}'
200, Set-Cookie: fs_session=fs_guest…  # a session scoped to that journal
```

So the page tells the reader there is no way in, and the API mints them a
session for that journal anyway. A session opens nothing by itself —
`mayReadTrip` still decides, and the refusal above is correct — so this is not
a way past a gate. What it is, is a capability that reports two answers, in a
subsystem where "off must mean absent" (AGENTS.md), and a journal that never
asked for sign-in still having sessions minted against its name and codes
written into its mail folder.

It also makes the manual privacy tests unrunnable without knowing this: an
operator who follows `docs/TESTING.md` section F and turns `auth` on where the
guide says to gets a gate with no form and no explanation. B215 now names both
files in the 🔑 note, which is a workaround for this, not a fix.

## Work

- Decide which question is right. If `auth` is genuinely per journal, the two
  API routes need the username they already parse out of the body. If it is a
  server-level capability that journals do not opt out of, the gate should stop
  asking per user.
- Whichever way, `/api/health` should say the same thing as both.

Not doing: the `mail` capability's own user-level default, which is deliberate
and documented in `USER_DEFAULT_FEATURES` (B60).

## Acceptance

- A journal that has not enabled `auth` either offers a sign-in form on its
  gate, or is refused by `/api/auth/request` — not one and then the other.
- A test asserts the two agree for the same journal.

## Triage

Confirmed as described, reproduced directly (not through curl, through the
routes): `isEnabled("auth")` with no username in both
`app/api/auth/request/route.ts` and `app/api/auth/verify/route.ts`, against
the trip gate's `isEnabled("auth", user)`.

**Decision: `auth` is per-journal, and the two routes were the outlier.**
`auth` is not in `USER_DEFAULT_FEATURES` (`lib/config.ts`) the way `mail` and
`whatsapp` are — those two are the documented exception (B60) for a
capability a journal is opted into unless it says otherwise; everything else,
`auth` included, is opt-in and absent means off. `/api/health` already asks
per journal via `resolveCapabilities(username)`, so before this fix two of
the three places asking the question already agreed with each other; the
routes were the one place still asking the server-wide ceiling alone.

**Fix.** Both routes still check the server-wide `isEnabled("auth")` first
(unchanged, and it needs no username). Added, after each route resolves the
username from the body and confirms the journal exists:

- `app/api/auth/request/route.ts` (~line 118, right after
  `const user = getUser(username); if (!user) return accepted;`): refuses
  with `404 auth_disabled` when `!isEnabled("auth", username)`.
- `app/api/auth/verify/route.ts` (~line 47, after the `invalid_request`
  check): `if (getUser(username) && !isEnabled("auth", username)) return 404
  auth_disabled`, deliberately gated on the user existing so an unknown
  username still falls through to the existing `invalid_code` 401 rather than
  gaining a new way to be distinguished from a wrong code.

**Disclosure.** For `/api/auth/request`, an unknown username is unaffected —
it still gets the uniform `202` regardless of `auth` state, so this adds no
oracle for "does this journal exist". For a *known* journal, the new `404`
tells a caller only what the trip gate and `/api/health` already show on the
page: whether this journal offers a sign-in form at all — no new disclosure,
just no second, contradicting answer. For `/api/auth/verify`, the same
reasoning, and the unknown-username path was checked explicitly to confirm it
still answers `401 invalid_code` rather than the new `404` (see the test
below), so guessing usernames against `/api/auth/verify` gains no new
distinguishing signal.

**Test:** `test/auth-journal-switch.test.ts` (new file), modelled on
`test/mail-journal-switch.test.ts`'s per-journal-switch shape. Covers: the
capability report and the gate already agreeing (sanity check), both routes
refusing for a journal that never mentions `auth`, both routes still working
for one that states it, and — the oracle check — an unknown journal on
`/api/auth/verify` still answering `invalid_code` rather than `auth_disabled`.
Confirmed each assertion fails against the pre-fix routes (404 expected, 202
or 200 received) and passes after.

**Acceptance:** met. `npm run verify` passes in full.
