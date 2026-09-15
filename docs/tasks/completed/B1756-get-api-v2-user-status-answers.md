---
id: B1756
title: GET /api/v2/{user}/status answers 500 when the credit balance has a fraction
type: ISSUE
priority: high
complexity: low
area: API v2
found: "2026-09-15T05:14:56Z"
started: "2026-09-15T05:19:50Z"
merged: "2026-09-15T05:46:49Z"
completed: "2026-09-15T08:19:23Z"
---

# B1756 — GET /api/v2/{user}/status answers 500 when the credit balance has a fraction

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## What happens

On fernscout.ch, the handover prompt printed at /severin/me works — POST
/api/auth/handover returns a 7-day fs_agent token — but the very next step it
tells the agent to take, GET /api/v2/severin/status, answers 500 with an empty
body. An agent reading that concludes the endpoint no longer exists and stops.

Server log:

    ZodError: [{ "expected": "int", "format": "safeint", "code": "invalid_type",
      "path": ["credits"], "message": "Invalid input: expected int, received number" }]

## Cause

`lib/api/v2/schemas/status.ts:46` declares `credits: z.number().int()`.

`balanceOf` (lib/credits.ts:190) has returned a fractional number since B987 —
its own doc comment says "which since B987 may carry a fraction: the stored
number is hundredths and this is where it stops being one". The live severin
balance is fractional, so `journalStatus.parse` throws on every request.

Only the status schema is wrong. `purchaseDoc.credits` (money.ts:40) is a
whole number bought, correctly int; `postcardOrderDoc.credits.balance`
(postcard.ts:63) is already a plain `z.number()`.

## Fix

Drop `.int()` from `journalStatus.credits`, keep the comment. Add a keeper
that parses a status document with a fractional balance. Regenerate
/api/v2/openapi.json and run keep-the-contract.

## Acceptance

GET /api/v2/severin/status on the live instance answers 200 with a fractional
`credits` value.

## Revalidation — valid

`lib/api/v2/schemas/status.ts:46` still read `credits: z.number().int()`, and
`lib/credits.ts:190`'s `balanceOf` still divides hundredths out. Reproduced
against the live instance on 2026-09-15: POST /api/auth/handover answered 200
with a fs_agent token, GET /api/v2/severin/status answered 500 with an empty
body, and the VPS journal carried the matching ZodError on `["credits"]`.

## What was done

- `journalStatus.credits` is `z.number()`, with the reason in the comment.
- `test/api-v2-status.test.ts` turns credits on (it had the capability off, so
  `balanceOf` returned null, `?? 0` made an integer, and no test in the file
  could ever reach this path — that is why it shipped). New keeper grants 3,
  spends 0.25, and asserts a 200 with `credits === 2.75`.

No openapi regeneration: `/api/v2/openapi.json` is built from these schemas at
request time, so widening the schema is the whole change.

## Acceptance

- Keeper fails on the old schema with the live error
  (`Invalid input: expected int, received number`), passes on the new one.
- `npm run verify` green.
- GET /api/v2/severin/status on the live instance answers 200 after deploy.
