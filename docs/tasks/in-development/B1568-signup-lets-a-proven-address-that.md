---
id: B1568
title: Signup lets a proven address that already owns a journal walk through phone verification before refusing
type: ISSUE
priority: high
complexity: low
area: signup / agent door
found: "2026-09-12T07:58:58Z"
started: "2026-09-12T08:20:40Z"
session: 94440113-24c0-47b4-a2ba-1cc4aedf74a6
claimed: "2026-09-12T08:20:40Z"
---

# B1568 — Signup lets a proven address that already owns a journal walk through phone verification before refusing

## Why

Reported by the owner, live, 2026-09-12: on `/agent` they chose "create a
journal", typed their own address, verified the email code, filled in the
journal form, verified their phone by SMS — and only then were told the
address already owns a journal.

The "already owns" check lives in one place, `createJournal()`
(`lib/journals.ts:316`, and the `reserve()` conflict at `lib/journals.ts:343`),
which the wizard reaches last: `components/SignupWizard.tsx` goes email →
code → journal form → `POST /api/v1/journals` → `phone_required` → phone/SMS
→ retry create → `too_many_journals`. Nothing earlier asks.

`/api/auth/signup/request` is deliberately a uniform 202 — an unauthenticated
"does this address have a journal" oracle is right to refuse — but
`/api/auth/signup/verify` is past that line: the caller has just proved they
can read the address, and `createJournal` already discloses the owned journal
by name to the same proof later. So the verify step can honestly say "this
address already owns `<user>` — sign in instead" and cost nothing.

The cost today: a person (the failing tester was the owner themself; the
71-year-old cohort is the audience) burns an SMS, several minutes and a fully
filled-in form before learning the answer was known at step two — and an SMS
send is real money on the live instance.

## Validation (2026-09-12)

Valid at take: `app/api/auth/signup/verify/route.ts` returned a token
unconditionally after `verifyCode`, and the only cap check was
`lib/journals.ts:316` / the `reserve()` conflict — reached after the phone
step, exactly as the report describes.

## Work

- In `app/api/auth/signup/verify/route.ts`, after `verifyCode` succeeds,
  check `journalsOwnedBy(email)` (`lib/journals.ts:145`); when the address is
  at `MAX_JOURNALS_PER_EMAIL`, answer `too_many_journals` naming the journal,
  instead of returning a signup token that can only fail later.
- In `components/SignupWizard.tsx`, catch that refusal at the code step: a
  new `owns` step shows the sentence and a "Yes, sign me in" button
  (`agent.haveJournalYes` — existing key, no new strings), which calls a new
  required `onAlreadyOwns` prop. `AgentDoor` wires it to `setHas(true)` —
  the same `IdentitySignIn` the door's "yes" answer shows — in both its
  branches (the signed-in branch now honours `has` too, for an identity
  whose *other* address owns the journal).
- Update `lib/api/openapi.ts` for the new refusal on the verify operation
  (keep-the-contract), and add `too_many_journals` to
  `lib/api/errorCodes.ts` — the contract test flagged that the code was
  never in the published vocabulary at all, because `/api/v1/journals`
  returns it via `createJournal()` and the scanner only reads literals.
- Route test: `test/signup-verify-owned.test.ts` — the refusal, its
  ordering after a correct code (no enumeration oracle), and the untouched
  no-journal path.
- Not doing: any change to `/api/auth/signup/request`'s uniform 202 — that
  privacy stance is correct and stays.

## Acceptance

- With a journal owned by `a@b.c`, `POST /api/auth/signup/verify` with a
  valid code for `a@b.c` answers `too_many_journals` (or equivalent) and no
  token; the wizard shows a sign-in path at the code step, never the phone
  step.
- An address with no journal is unaffected end to end.
- `/openapi.json` documents the refusal.

## Notes

Second half of the same report, not yet confirmed as a bug: the owner
believed they were signed in yet met the door at all. The door renders only
when `resolveIdentity()` is null, and B1492's silent upgrade (deployed —
commit 1891b14f carries it) covers a browser holding `fs_session` without
`fs_identity`, so that browser most likely held no live cookie of either
kind. If it recurs while `/<user>/trips` still shows them as owner in the
same browser, capture that separately with the cookie jar's contents —
`IdentityUpgrade`'s fetch swallows failures (`catch(() => {})`), so a broken
upgrade route is invisible from the page.
