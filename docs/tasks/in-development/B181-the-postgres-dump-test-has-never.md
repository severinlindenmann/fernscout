---
id: B181
title: The Postgres dump test has never run anywhere, so the production dialect is unexercised
type: CHORE
priority: medium
complexity: medium
area: tests, db, postgres, ci
found: "2026-09-03"
started: "2026-09-03T19:43:08Z"
session: 0c03d994-da58-4a02-ab85-107825393b1a
claimed: "2026-09-03T19:43:08Z"
---

# B181 — The Postgres dump test has never run anywhere

## Why

```
↓ the dump taken from a real Postgres is one pg_restore can list
```

The one test that proves a backup of the **production** database is restorable
had never run anywhere. For a *backup* test the stakes are the ones B21 and
B114 already argued: `content/` originals exist nowhere else, and a dump nobody
has restored is a belief rather than a backup.

**Two things in the original Why were wrong, and finding out changed the fix.**

1. *"`POSTGRES_TEST_URL` is set nowhere in this repository."* It is. This repo
   has CI — `.github/workflows/ci.yml` — and its `test` job already runs the
   whole suite twice, the second time against a `postgres:17-alpine` service
   container with `POSTGRES_TEST_URL` pointed at it. So `db-migrations` and
   `db-repos` **do** exercise the production dialect, and have since that
   matrix was written. The dialect is not unexercised.

2. The dump test is skipped by something else entirely. Its file is
   `describe.runIf(RESTIC)` (`test/backup-script.test.ts:94`), and **nothing in
   CI installs restic** — so the entire restore drill, all twenty-odd tests of
   the only thing that would get the photographs back, has been skipping in CI
   from the day it was written. `POSTGRES_TEST_URL` was never the binding
   constraint for this one test.

And a third thing, found while trying to read the skip message that was
supposed to be loud: **it was not being printed at all.** Vitest 4 defaults
`silent` to `"passed-only"`, so `console.warn` from a file whose tests all pass
is collected and discarded. Both existing "loud" skips — restic, and
`POSTGRES_TEST_URL` — have been announcing themselves to nobody:

```
$ npx vitest run test/db-migrations.test.ts
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

A skip nobody can see is indistinguishable from a pass, which is the whole
complaint.

Two smaller facts that decided the shape of the fix:

- The `ubuntu-24.04` runner image ships **PostgreSQL 16.15**, and the service
  container is 17. `pg_dump` refuses to dump a server newer than itself
  ("aborting because of server version mismatch"), so simply installing restic
  would have produced a red drill about tooling rather than about backups.
- `scripts/backup.sh:200` shells out to `pg_dump`, and the test to
  `pg_restore`. Binaries, not a server — the service container's own copies are
  musl-linked and inside the container, so they are no help.

## Work

**Route taken: 2 — CI is the place it runs**, with route 3's actionable skip
alongside it. Not route 1 (a container started by the suite): CI already had a
Postgres service and the missing pieces were restic and a matching `pg_dump`,
so a testcontainers dependency would have added a devDependency, a Docker
requirement and a new skip path to solve a problem CI had already solved. On
this machine the daemon is stopped, so it would have skipped locally anyway —
paying a dependency for the same silence.

Done:

- **`.github/workflows/ci.yml`** — a new `backup-drill` job, and `build` now
  needs it. It brings the three preconditions together for the first time: a
  `postgres:17-alpine` service, restic pinned to 0.19.1 (checksum-verified from
  the release, matching what `brew install restic` gives, so CI and a laptop
  test the same program rather than apt's 0.16.4 which takes a different branch
  in `scripts/backup.sh`'s repository probe), and `postgresql-client-17` from
  PGDG with `/usr/lib/postgresql/17/bin` put first on `PATH`. A precondition
  step asserts all three *before* vitest, because a job that skips everything
  goes green and that is the failure being fixed. It runs only
  `test/backup-script.test.ts`; the existing `test` matrix is untouched.
- **`test/support/announce.ts`** (new) — `announceSkip()`, writing to
  `process.stderr`, which Vitest does not intercept. Without this the rest is
  invisible.
- **`test/support/dialects.ts`** — `POSTGRES_HOWTO`, the container recipe, in
  one place because three files quote it. Same image and credentials as the CI
  job, so reproducing a CI failure means talking to the same Postgres.
- **`test/db-migrations.test.ts`** — the Postgres skip now prints the command.
- **`test/backup-script.test.ts`** — the restic skip prints install commands;
  and a new announcement for the dump test names *which* of its three
  preconditions is missing, rather than leaving a `runIf` to fail silently.
- **`docs/archiv/running-locally.md`** — "What a green run on your laptop did
  not check", under the pre-push section.

**Not done, deliberately:**

- No assertion changed. The dump test is character-for-character what it was.
- Nothing installed on this machine, no daemon started, no dependency added.
- The `test` matrix keeps its guard exactly as it was.

**Not verified, and it cannot be from here:** the drill has never been observed
to run. This machine has no `pg_dump`, no `pg_restore`, and a stopped Docker
daemon, and CI cannot be triggered without pushing. The restic release asset
and its SHA-256 were checked over the network, the runner image's PostgreSQL 16
was read from `actions/runner-images`, and the YAML parses — but whether the
`backup-drill` job is green is unknown until the branch is pushed. **That is
the thing to look at in testing.**

Follow-ups captured: B185 (the dump is taken from a database no migration has
touched, so `pg_restore -l` lists an almost empty archive), B186 (every
`docs/…` link in README.md points one directory above where the file is).

## Acceptance

- The Postgres dump test either runs in a documented environment that exists,
  or its skip names the exact command that would make it run.
- If a container route is chosen, a machine with the daemon stopped skips
  cleanly and says why, rather than failing.
- No assertion is weakened to achieve any of the above.
