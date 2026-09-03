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
is guarded on `POSTGRES_TEST_URL`, which is set nowhere in this repository. The
same guard skips the Postgres dialect in `test/db-migrations.test.ts` and
`test/db-repos.test.ts`.

`AGENTS.md` says "local dev is SQLite, production is Postgres, and nothing
outside `lib/db/` knows which". The guard is what makes that liveable — but it
means the dialect the live site actually runs is covered by tests that have
never executed. For a *backup* test the stakes are the ones B21 and B114
already argued: `content/` originals exist nowhere else, and a dump nobody has
restored is a belief rather than a backup.

This machine has no `postgres`, `pg_dump`, `pg_restore` or `initdb`. Docker is
installed but its daemon is not running. The `pg` npm package is a dependency,
so the client side is present; the server is not.

So this is not a matter of removing a guard. Something has to actually provide
a Postgres for the test to talk to, and the honest answer may be that a
developer laptop should not be made to — in which case the fix is that **CI**
provides one and the local skip becomes a documented, actionable message
rather than a silent pass.

## Work

Establish, in this order:

- **Can the suite provide its own Postgres without installing system
  packages?** A container started for the test is the usual answer, and Docker
  is present here but not running. If that is the route, the suite must degrade
  cleanly when the daemon is down — an unavailable daemon is a skip, not a
  failure — and the skip must say what to start.
- **If not, make CI the place it runs**, and say so. A service container in the
  workflow, `POSTGRES_TEST_URL` pointed at it, and the guard left alone.
- Either way, **the skip message must be actionable.** Today the developer is
  told a variable is unset; they should be told what to run.

Whatever is chosen, `pg_dump` and `pg_restore` are needed by the *script*, not
just a server — check `scripts/backup.sh`'s Postgres branch actually has the
binaries it needs in whatever environment is chosen.

**Not doing:** installing Postgres or starting Docker on anybody's machine from
the suite. Do not weaken what the test asserts in order to make it run.

## Acceptance

- The Postgres dump test either runs in a documented environment that exists,
  or its skip names the exact command that would make it run.
- If a container route is chosen, a machine with the daemon stopped skips
  cleanly and says why, rather than failing.
- No assertion is weakened to achieve any of the above.
