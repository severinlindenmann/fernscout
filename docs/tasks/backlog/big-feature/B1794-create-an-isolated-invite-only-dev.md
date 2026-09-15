---
id: B1794
title: Create an isolated invite-only dev environment with safe provider modes and promotion
type: FEATURE
priority: medium
complexity: high
area: dev environment, provider isolation, promotion
found: "2026-09-15T10:16:10Z"
---

# B1794 — Create an isolated invite-only dev environment with safe provider modes and promotion

## Why

We need a safe place to exercise production flows without spending money,
contacting real recipients, or changing the live service. A dedicated
`dev.fernscout.ch` environment should behave like production for invited
users while isolating every provider and its budgets.

## Work

Create `dev.fernscout.ch` on the same VPS, running in parallel with
production and unable to affect production data, traffic, credentials, or
resource budgets. Keep access invite-only, matching the current production
invite policy.

Configure provider-specific development behavior:

- Gelato uses a test account (its account-level sandbox/no-payment-provider
  mode).
- Mail may be enabled, but every development message is clearly marked with a
  `TEST-` subject prefix.
- Deepgram and Anthropic use separate test accounts and budgets.
- WhatsApp marketing, Twilio, and WhatsApp chat use dry runs that persist the
  would-be request to a folder instead of calling the real API.

Provide a deliberate “Promote” action so an owner can promote a verified dev
configuration/content release to production in one explicit step, with the
production safeguards and credentials preserved.

## Acceptance

- `dev.fernscout.ch` is reachable on the VPS alongside production and remains
  invite-only under the same access rules.
- Development traffic, storage, jobs, credentials, provider accounts, and
  budgets are isolated; exercising dev has no observable impact on
  production.
- Gelato, mail, Deepgram, and Anthropic follow the test-account, subject
  prefix, and budget rules above.
- WhatsApp marketing, Twilio, and WhatsApp chat write dry-run payloads to the
  configured folder and make no real provider API calls.
- An owner can use “Promote” to move an approved dev release to production;
  the action is explicit, auditable, and cannot silently alter production.
- Existing production behavior and provider configuration remain unchanged.
