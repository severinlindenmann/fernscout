---
id: B205
title: Redeeming an invite promises a code the server may have no way to send
type: ISSUE
priority: medium
complexity: low
area: contacts, mail
found: "2026-09-04T06:07:17Z"
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

## Acceptance

- With `features.mail.enabled: false` and `contacts` on, redeeming a valid
  guest link answers something other than `{"status": "code"}` — a test that
  fails today.
- A code that was already live for that address is still live afterwards.
- `/api/contacts/request` answers exactly as it does now, with the same work
  off the response path.
