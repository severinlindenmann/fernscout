---
id: B997
title: The hundredths migration opens its own transaction inside the one the migrator already opened, so it fails on Postgres
type: ISSUE
priority: high
complexity: low
area: credits
found: "2026-09-08T17:11:48Z"
started: "2026-09-08T17:12:04Z"
session: 6c81e17b-6acf-4c0f-86ef-49124c9b2458
claimed: "2026-09-08T17:12:04Z"
---

# B997 — The hundredths migration opens its own transaction inside the one the migrator already opened, so it fails on Postgres

## Why

The deploy that would have shipped B987 failed at the migration:

```
Error: calling the transaction method for a Transaction is not supported
  at Object.up (/srv/fernscout/lib/db/migrations/027-credits-hundredths.ts:31)
```

Kysely's migrator already runs each migration inside a transaction. `up()`
opened a second one, which Postgres's driver refuses outright.

**Nothing was written and the live site never moved** — the deploy runs
migrations before it restarts, so the old build kept serving and `/api/health`
stayed green on the previous commit. That is the failure mode this ordering
exists for, and it worked.

Why the test did not catch it: `test/credits-hundredths-migration.test.ts`
calls `up(db)` with a plain Kysely instance, which is not how the migration is
ever actually run. It tested the SQL and not the contract with the migrator —
and the contract is what broke.

## Work

- Drop the inner transaction. The migrator's own is what makes the two
  statements atomic, and it is the only one there may be.
- The test runs the **migrator**: migrate to the migration before this one,
  seed rows in whole credits, then `migrateToLatest`. A test that calls `up()`
  by hand cannot see this class of fault at all.

## Acceptance

- `npm run verify` green, with the migration test driving the migrator.
- The deploy applies 027 against the live Postgres and comes up healthy.
