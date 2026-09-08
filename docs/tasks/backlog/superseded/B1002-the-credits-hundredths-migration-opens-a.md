---
id: B1002
title: The credits-hundredths migration opens a transaction inside the one it is already in, and Postgres refuses
type: ISSUE
priority: high
complexity: low
area: database, deploy
superseded: "B997 — fixed there, in another session, within the same hour"
found: "2026-09-08T17:17:57Z"
---

# B1002 — The credits-hundredths migration opens a transaction inside the one it is already in, and Postgres refuses

## Why

`027-credits-hundredths.ts` called `db.transaction()` inside the transaction
Kysely's migrator already opens. SQLite never noticed; Postgres refused —
*calling the transaction method for a Transaction is not supported* — and took
`ship.sh` down with it at the migration step, leaving the live site on the old
build.

Captured while deploying, and fixed in B997 by another session in the same
hour. Kept as the record that the deploy is where this was found.

## Work

None — see B997.

## Acceptance

`.claude/skills/vps/ship.sh` gets past the migration step.
