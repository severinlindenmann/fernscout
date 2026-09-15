---
id: B1756
title: GET /api/v2/{user}/status answers 500 when the credit balance has a fraction
type: ISSUE
priority: high
complexity: low
area: API v2
found: "2026-09-15T05:14:56Z"
started: "2026-09-15T05:19:50Z"
session: 4c78c009-c6da-4779-a13c-eb1d3c84a792
claimed: "2026-09-15T05:19:50Z"
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
