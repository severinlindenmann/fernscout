---
id: B205
title: Redeeming an invite promises a code the server may have no way to send
type: ISSUE
priority: medium
complexity: low
area: contacts, mail
found: "2026-09-04T06:07:17Z"
started: "2026-09-04T07:52:18Z"
merged: "2026-09-04T08:19:52Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T07:38:39Z"
---

# B205 — Redeeming an invite promises a code the server may have no way to send

## Why

Found while building B160, which fixed the same shape in
`POST /api/auth/request`, and deliberately not absorbed into it: B160's
acceptance names one route, and this is a different door with a different
argument about what it may leak.

`POST /api/contacts/redeem` (`app/api/contacts/redeem/route.ts:162`) checks
`isEnabled("contacts", username)` and never `isEnabled("mail")`. On the
ordinary path — somebody who is not already signed in follows a guest or buddy
link — it calls `issueCode`, then `sendCodeMail`, then answers
`202 {"status": "code"}`, which the page in front of the reader renders as *we
have sent you six digits, go and get them*.

With mail off for the server, `sendCodeMail` returns null without sending. So
the reader is told to check an inbox nothing will arrive in, and — because
`issueCode` consumes every live code for that address before writing a new one
(`lib/auth/index.ts:254`) — any code they were already holding is dead. That is
the same pair of costs B160 removed from the sign-in route: a promise that
cannot be kept, and a live credential taken away to make it.

`lib/deletions.ts:223` and `app/api/auth/signup/request/route.ts:27` both refuse
up front when the server cannot send. This route and `/api/contacts/request`
are what is left.

**`/api/contacts/request` is not the same case and should be left alone.** Its
202 is uniform by construction (B159): everything that could vary — the insert,
the code, the mail — was deliberately moved off the response path so that a
dead invite token and a live one cost the same. A refusal there would put the
oracle back, in the status line this time. Whatever this task does, it does not
touch that route; if the promise-with-no-mail problem is worth fixing there, it
is worth a separate argument about how to do it without re-timing the endpoint.

## Work

- Decide what redeem should answer when `isEnabled("mail")` is false. `503
  mail_disabled` with a sentence, matching the signup route, is the obvious
  candidate and leaks nothing: the answer is the same for every address and
  every token, so neither "is this token live" nor "is this address known"
  becomes askable.
- Consider whether the *signed-in* branch is affected. It sends
  `sendConfirmedMail` and `notifyOwnerOfRequest` but issues no code and makes
  no promise about an inbox, so it may be correct to let it proceed with mail
  off rather than refuse a confirmation that otherwise works.
- Refuse before `issueCode`, not after.
- Not this task: `/api/contacts/request`, for the reason above.

## What was built

`503 mail_disabled`, as the Work section proposed, in
`app/api/contacts/redeem/route.ts` — placed immediately after the session is
resolved and **before `requestContact` as well as before `issueCode`**. The
Work section only asked for the second; refusing before the first as well means
a redemption that cannot finish also does not leave a `pending` row in the
owner's queue for somebody who was never able to prove their address.

Two corrections to the Why, both found while building:

- **The condition is not only `isEnabled("mail")`.** `sendCodeMail` goes
  through `sendMail`, which honours the server switch *and* the journal's own
  `features.mail.enabled: false` (`hasSwitchedOff`, B60). Checking only the
  server switch would have left the identical broken promise standing for a
  journal that had switched mail off, which is the obvious way somebody says
  "do not write to my readers". The guard asks both questions.
- **The 503 discloses nothing this route was keeping.** Worth stating because
  it looks at first like a token oracle: a dead token is answered `202
  {"status":"expired"}` and a live one now gets a 503. But the 202/expired
  answer is itself a deliberate disclosure — the comment above it says so, and
  the landing page has already said it in words. What the new answer does not
  vary with is the *address*, so it is not a way to ask who is known here or
  who has been blocked.

The signed-in branch is left to proceed, as the Work section suggested: it
issues no code, promises no inbox, and the request it files is real work that
mail being off does not undo.

The reader-facing half: `components/InviteRedeem.tsx` mapped an unrecognised
error to `contact.error` ("something went wrong"). It now says what happened —
`invite.noMail`, added to `en`, `de` and `hu` — because there is nothing the
reader can do differently and the previous answer left them waiting.

## Acceptance

- With `features.mail.enabled: false` and `contacts` on, redeeming a valid
  guest link answers something other than `{"status": "code"}` — a test that
  fails today. ✅ — `test/redeem-mail-off.test.ts`, "is refused rather than
  promised a code". Before the fix: `expected 'code' not to be 'code'`.
- A code that was already live for that address is still live afterwards. ✅ —
  "leaves a code that was already live alone" issues a code, redeems, and then
  verifies the first code. Before the fix it was consumed.
- `/api/contacts/request` answers exactly as it does now, with the same work
  off the response path. ✅ — `app/api/contacts/request/route.ts` is not in the
  diff, and the test file asserts a live token and a dead one get the byte-
  identical `202 {"status":"accepted"}` with mail off.

## Evidence

```
$ npx vitest run test/redeem-mail-off.test.ts    # with the route stashed
  × is refused rather than promised a code
  × leaves a code that was already live alone
  × writes no contact
  Tests  3 failed | 3 passed (6)
$ npx vitest run test/redeem-mail-off.test.ts    # with the fix
  Tests  6 passed (6)
$ git diff --stat app/api/contacts/request/route.ts
  (no output — untouched)
```
