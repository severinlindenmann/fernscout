---
id: B200
title: The restore drill dumps a database no migration has touched, so the archive it proves restorable is empty
type: CHORE
priority: low
complexity: low
area: tests, db, postgres, backup
found: "2026-09-03T20:05:00Z"
started: "2026-09-04T07:17:29Z"
merged: "2026-09-04T07:49:24Z"
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

## What was built

`test/backup-script.test.ts`, the last test — renamed to *the dump taken from a
real Postgres holds the schema and the rows*, because that is now what it
checks:

- `freshDatabase()` from `test/support/dialects.ts` migrates the database the
  drill is about to dump, and one `users` row with a sentinel address
  (`restore-drill-<ms>@example.invalid` — obviously nobody, for
  `test/depersonalised.test.ts`) is inserted before `scripts/backup.sh` runs.
- The archive's table of contents must name **every** table in `TABLE_NAMES`,
  not merely exist.
- And the archive is *read*, not only listed: `pg_restore -f -` emits the SQL,
  and the sentinel has to be in it. Listing was not enough — `pg_restore -l`
  names a `TABLE DATA` entry whether or not a single row is behind it, so the
  row assertion needed the restore path. That answers the Work section's open
  question: reading the archive to stdout costs about a second and needs no
  scratch database, so a second database was not worth it.

The `backup-drill` CI job needs no change: the test now migrates the service
container itself and depends on no other job's state.

## Evidence — from a real Postgres, not a skip

A PostgreSQL 16 cluster was started locally (`initdb` + `pg_ctl` on port 54329,
`postgresql@16` and its `pg_dump`/`pg_restore`), so all three preconditions
were genuinely met and nothing below is a skip.

1. **The defect, demonstrated.** The pre-change test (`git show HEAD:`) run
   against a database with *no schema at all*: `1 passed`. It asserted a valid
   archive header over a dump of nothing, which is exactly the reading this
   ticket disputes.
2. **The new test passes** against the migrated, seeded database: `1 passed`.
3. **It fails when the dump has no tables** — the same test with the backup
   pointed at a second, empty database:
   `AssertionError: users is missing from the archive's table of contents`.
4. **It fails when the tables are there and the row is not** — the same test
   seeding a different address:
   `AssertionError: the archive must carry the row, not just the empty table`.

Whole file against that Postgres: 23 passed, 1 skipped (the real-`timeout`
case; this machine has no coreutils).

Nothing here needs the VPS. What it still does not prove is B21 items 1 and 2 —
that the *service* comes back — which stays a person's drill.
