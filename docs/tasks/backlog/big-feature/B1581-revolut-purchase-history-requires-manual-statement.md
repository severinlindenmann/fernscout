---
id: B1581
title: Revolut purchase history requires manual statement imports
type: FEATURE
priority: low
complexity: high
area: costs, integrations
found: "2026-09-12T10:24:54Z"
---

# B1581 — Revolut purchase history requires manual statement imports

## Why

Owners must export and supply statements to bring Revolut purchases into their
travel costs. `importers/costs/index.ts:14` already registers both consolidated
and account-statement CSV importers, but there is no automatic bank connection.
The user requested this as a future feature after researching API feasibility.
Low priority records that future intent; high complexity is a provisional
estimate pending provider selection and coverage checks.

## Work

Explore an optional, owner-authorised connection for Revolut personal accounts
that periodically retrieves purchases and feeds the existing cost-review flow.
Keep CSV imports available. Fetching may be automatic; assigning purchases to
trips and agreeing merchant categories remains the owner's decision before the
existing cost-import API writes anything into days.

Research findings from 2026-09-12:

- Revolut's Business API requires a Business account and is not the personal
  account integration this feature needs:
  https://www.revolut.com/business/business-api/
- Direct Open Banking production access is for regulated third-party providers:
  https://developer.revolut.com/docs/guides/build-banking-apps/introduction-to-the-open-banking-api/introduction
- A provider such as TrueLayer is a candidate for hosted consent and transaction
  access, not a selected dependency:
  https://docs.truelayer.com/docs/create-a-connection-v3
- Revolut documents four background transaction fetches per account per day and
  a 90-day history window after the first five minutes following authorisation.
  Recheck these constraints when designing initial import and ongoing sync:
  https://developer.revolut.com/docs/api/open-banking

Before promotion, establish Swiss Revolut personal-account coverage, provider
eligibility and pricing, consent renewal, and how hosted and self-hosted
instances would obtain provider access. These are open decisions, not promises
that the research verified. Scope the first supported account types explicitly.

Implementation should request read access only, protect connection credentials,
support disconnect and reconnect, and handle duplicate fetches, pending-to-booked
changes, refunds and multiple currencies. Keep raw bank data private and settle
retention/deletion rules before implementation. No payment initiation or
automatic publication of financial data is in scope.

## Acceptance

- A supported personal-account owner can connect Revolut through an authorised
  consent flow and receive new purchases without exporting a statement.
- Initial history limits and refresh timing are documented accurately; repeated
  syncs and pending-to-booked changes do not duplicate expenses.
- The owner reviews trip inclusion and categories before any costs reach days;
  raw purchase history is inaccessible to journal readers.
- Disconnect stops future retrieval, and expired consent has a working reconnect
  path. CSV import continues to work without a provider connection.
- Provider coverage, costs and instance setup are documented, including the
  verified outcome for Swiss personal accounts. Simulated-provider checks cover
  sync failures, refunds, currencies and duplicate delivery without a paid account.
