---
id: B653
title: The backup set is everything under DATA_DIR minus what somebody remembered to subtract
type: CHORE
priority: high
complexity: medium
area: backup, DR, scripts/backup.sh
found: "2026-09-07T05:44:26Z"
started: "2026-09-07T05:48:16Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-07T05:48:16Z"
---

# B653 — The backup set is everything under DATA_DIR minus what somebody remembered to subtract

## Why

**Design: `docs/plans/W42-what-a-backup-owes.md`.** Step 1 of its Order, and
the only step that stands alone.

`scripts/backup.sh` stages everything under `DATA_DIR`, then subtracts: `rm
-rf "$STAGING_DIR/data/mail"` is the whole subtraction (B636). A set defined
that way grows by default, and on this instance it has:

```
553M  content/                     the payload
296M  home/.npm + home/.cache      npm cache, nightly, forever
 93M  example-before-b325.tgz      an archive left behind in June
```

Forty per cent of a 915 MiB snapshot is build cache and a stray tarball.

Worse in the other direction: **`/etc/fernscout/env` has never been backed
up.** It sits outside `DATA_DIR`, so a restore returns every journal and
photograph and cannot start the service — no `DATABASE_URL`, no VAPID keys,
no SMTP credentials, no `FERNSCOUT_ADMIN_EMAIL`.

And it is why B651 happened: two root-owned `config.json.bak` files nobody
needed made two nights `partial` and fired the alert twice.

## Work

- Replace the subtractive set with an allowlist: `db/postgres.dump`,
  `content/`, `$DATA_DIR/config.json`, and `/etc/fernscout/env` staged as
  `env/fernscout.env`.
- **Strip `RESTIC_PASSWORD` from the staged env file.** A backup carrying the
  key to itself is no use to somebody holding only the backup, and widens the
  blast radius if the repository leaks. The runbook must then say where that
  one secret is kept — see B656.
- **Log every top-level entry under `DATA_DIR` that was not staged.** This is
  not decoration: the allowlist moves the failure mode from "junk silently
  included" to "something new silently excluded", and this line is the only
  thing that catches the second. Without it, do not ship the allowlist.
- Leave B114's partial-snapshot machinery exactly as it is for the paths the
  set claims. An unreadable `content/` is still a failure, and must be.
- Exclude generated output — `postcards/`, `photobooks/`, `mail/`. Orders are
  rows in Postgres and sources are in `content/`; what is lost is a PDF that
  can be produced again.
- The env file is `root:fernscout 0640`. Check the unit can read it, and say
  in the task what you found rather than widening the mode.

Not doing: anything about Proton, rclone or a second destination. B654 and
B655.

## Acceptance

- A run stages `content/`, the Postgres dump, `config.json` and the env file,
  and nothing else. The snapshot is around 555 MiB rather than 915 MiB.
- `env/fernscout.env` is present in a restored snapshot and contains no
  `RESTIC_PASSWORD`.
- The log names `home/` and `example-before-b325.tgz` as skipped.
- A root-owned unreadable file beside `config.json` does not make the run
  partial; an unreadable file under `content/` still does.
- `test/backup-script.test.ts` covers each of the four lines above.
