---
id: B200
title: The restore drill dumps a database no migration has touched, so the archive it proves restorable is empty
type: CHORE
priority: low
complexity: low
area: tests, db, postgres, backup
found: "2026-09-03T20:05:00Z"
started: "2026-09-04T07:17:29Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T07:17:29Z"
---

# B200 — The restore drill dumps a database no migration has touched

## Why

`test/backup-script.test.ts:774` — "the dump taken from a real Postgres is one
pg_restore can list" — runs `scripts/backup.sh` with `DATABASE_URL` pointed at
`POSTGRES_TEST_URL` and then asserts `pg_restore -l` exits 0 and prints
"Archive created at".

Nothing in that file ever migrates the database. Since B181 the test runs in
its own CI job (`backup-drill` in `.github/workflows/ci.yml`) which runs only
this one file, so the schema is whatever a previous job happened to leave —
in a fresh service container, nothing at all. `pg_dump -Fc` of an empty
database still writes a valid archive with a header, so the assertions pass
against a dump of *nothing*.

That is not zero value: it proves the script reaches `pg_dump`, that the dump
lands in the snapshot, survives a restic round trip, and is a well-formed
custom-format archive. But the sentence it is read as — "a backup of the
production database is restorable" — is stronger than what it checks. A dump
that dropped every table would pass it.

## Work

- Migrate the database, and preferably put a row in it, before running the
  backup. `freshDatabase()` in `test/support/dialects.ts` already does the
  first half.
- Then assert the listing contains something: a known table name, or simply
  more entries than an empty archive has.
- Consider whether `pg_restore` into a scratch database, rather than `-l`,
  is worth the extra time — listing an archive is not reading it.

**Not doing:** widening the drill into a general Postgres suite. `db-repos`
and `db-migrations` already cover the dialect; this test is about the dump.

## Acceptance

- The test fails if `scripts/backup.sh` produces a dump with no tables in it.
- It still passes in the `backup-drill` job with no other job's state relied on.
