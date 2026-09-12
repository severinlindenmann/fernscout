---
id: B1553
title: test- usernames skip phone proof but still receive the 10-credit grant and 5 GB quota
type: SECURITY
priority: high
complexity: low
area: signup/credits
found: "2026-09-11T23:06:54Z"
started: "2026-09-12T07:22:48Z"
session: 5c987a64-dfc0-4ac9-9b57-3804213ba1b8
claimed: "2026-09-12T07:22:48Z"
---

# B1553 — test- usernames skip phone proof but still receive the 10-credit grant and 5 GB quota

## Why

`app/api/v1/journals/route.ts:389` exempts any username starting `test-` from
phone verification (alongside the admin email), yet lines 525-531 grant
`SIGNUP_CREDIT_GRANT = 10` credits (`lib/credits.ts:394`) to every created
journal, `test-` included, each with the full 5 GB `perUserBytes` quota.
`MAX_JOURNALS_PER_EMAIL = 1` costs an attacker only a disposable inbox, and the
per-IP `CREATED_DAILY` of 15/day (`journals/route.ts:61`) still allows 150
credits + 75 GB nominal quota per IP per day with no phone proof at all.
Credits fund operator-billed spends — model turns, transcription (see B1550),
WhatsApp sends. B834 assumed phone proof as the second wall; `test-` walks
around it while keeping the grant.

## Work

- Skip `grant()` for `test-` journals — test content has no need of credits.
- Consider a smaller `perUserBytes` for `test-` journals as well.
- Not doing: removing the `test-` exemption itself; test journals staying
  cheap to create is deliberate (AGENTS.md names the convention).

## Acceptance

Creating a `test-` journal leaves its balance at zero (verify via the credits
ledger); a normal phone-verified signup still receives the grant.
`test/credits.test.ts` (or a signup test) pins it.
