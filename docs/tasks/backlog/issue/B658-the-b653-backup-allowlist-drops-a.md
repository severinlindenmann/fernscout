---
id: B658
title: The B653 backup allowlist drops a no-database deployment's own state
type: ISSUE
priority: high
complexity: low
area: backup, DR, scripts/backup.sh
found: "2026-09-07T06:05:44Z"
---

# B658 — The B653 backup allowlist drops a no-database deployment's own state

## Why

B653 turned `scripts/backup.sh`'s set into an allowlist: `db/postgres.dump`,
`content/`, `config/config.json`, `env/fernscout.env`, per
`docs/plans/W42-what-a-backup-owes.md`. That set was written against this
instance's own `DATA_DIR`, which — being Postgres — holds nothing else worth
naming.

It is not true of every deployment this script serves. `docs/runbook.md:107`
says outright: **"Leave `DATABASE_URL` unset for a public-only site."** That is
a supported shape, not a prototype curiosity, and `lib/repos/index.ts` backs
it: "if a database is configured, use it; otherwise use the file store."
With no `DATABASE_URL` — or with `DATABASE_URL=sqlite:…`, the other
self-hosting-without-Postgres option `lib/db/url.ts` documents — the only copy
of that state lives under `DATA_DIR`:

- `reactions.json` — every vote on every published day (`lib/repos/reactionsFile.ts`)
- `push-subscriptions.json` — every browser subscribed to notifications
  (`lib/repos/pushFile.ts`)
- `fernscout.db` — the whole SQLite database, when that is the dialect

None of the three is in the new allowlist. Under the old subtractive script
they were backed up as part of `DATA_DIR`; under the allowlist they are simply
never staged. The only visible trace is one "skipped" line per file, per
night, forever — the safeguard the allowlist ships with, but easy to read past
on an instance that has never had reason to look.

This is exactly the shape B653's own design accepts as the trade for killing
the npm-cache-and-stray-tarball problem: a new thing that matters gets named
as skipped until somebody adds it, rather than silently included until
somebody notices the size. The naming is doing its job. Nobody has decided
yet whether these three files belong in the set.

## Work

Decide, for the no-database and sqlite tiers, whether `reactions.json`,
`push-subscriptions.json` and `fernscout.db` join the allowlist (e.g. under a
`state/` prefix, staged only when `DATABASE_URL` is unset or `sqlite:`), or
whether losing them nightly is accepted for those tiers and the runbook says
so explicitly. Either way:

- Update `docs/runbook.md`'s backup-contents section (B656 already owns this
  page for the rest of the W42 layout change).
- If they join the set, extend `test/backup-script.test.ts` accordingly —
  round-trip byte-identity for the sqlite file, and the two JSON stores.
- If they do not, say so in the runbook next to "Leave `DATABASE_URL` unset
  for a public-only site" — the sentence that makes this a real deployment
  shape rather than a hypothetical one — not only in this task file.

Not doing: anything about Proton, rclone or a second destination (B654,
B655). Not touching the Postgres-tier behaviour, which is unaffected either
way.

## Acceptance

- `docs/runbook.md`'s "Contents" line for backups states plainly whether a
  no-database or sqlite deployment's own state is in the nightly backup, and
  it is true.
- If the decision is "back it up": a fresh no-database fixture's
  `reactions.json`/`push-subscriptions.json`, and a fresh sqlite fixture's
  `fernscout.db`, survive a `runBackup()` → `restoreLatest()` round trip
  byte-identical in `test/backup-script.test.ts`.
