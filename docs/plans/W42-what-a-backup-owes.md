# W42 — What a backup owes

A backup is not a copy of a machine. It is a promise that the service can be
rebuilt from it, and the only honest test of that promise is to try. This
instance's nightly run has never been tried, and on the morning of
2026-09-07 it turned out it could not have been kept.

Three facts, all found in one deploy:

- The snapshot is **915 MiB**, of which **296 MiB is an npm cache**
  (`/var/lib/fernscout/home/.npm` and `.cache`) and **93 MiB is
  `example-before-b325.tgz`**, an archive somebody left behind in June. Forty
  per cent of every night, forever, is build cache and a stray tarball.
- **`/etc/fernscout/env` has never been in a backup.** It lives outside
  `DATA_DIR`, and `scripts/backup.sh` stages `DATA_DIR` and `content/`. So a
  restore returns every journal and every photograph and leaves the service
  unable to start: no `DATABASE_URL`, no VAPID keys, no SMTP credentials, no
  `FERNSCOUT_ADMIN_EMAIL`.
- The run had been **failing for two nights** because two root-owned
  `config.json.bak` files could not be read by the service user (B651). The
  snapshot was pushed and tagged `partial`; the alert fired both nights.

The first and third have one cause. `backup.sh` stages **everything under
`DATA_DIR`** and then subtracts what it does not want — `rm -rf
"$STAGING_DIR/data/mail"` is the whole of that subtraction, added by B636.
A set defined by subtraction grows by default: every directory anyone ever
creates beside the config joins the backup, and every unreadable stray
downgrades the night. Neither the npm cache nor the two `.bak` files were
decisions. They arrived, and the script had no opinion.

## What this changes

**The backup set becomes an allowlist**, and the log names what it skipped.

```
db/postgres.dump        pg_dump, as today
content/                journals and originals — the part that exists nowhere else
config/config.json      the instance's own config
env/fernscout.env       /etc/fernscout/env, with RESTIC_PASSWORD removed
```

The inversion is the point. Under the old rule the failure mode was *junk
silently included*, which is invisible until somebody reads a size. Under the
new one it is *something new silently excluded*, which is worse — so the
script says, on every run, which top-level entries it did not stage. A new
directory that matters gets one line of output per night until somebody adds
it. That line is the safeguard, and it is the reason an allowlist is safe to
adopt.

It also settles B651 without a judgement about ownership: a root-owned stray
beside `config.json` is not in the set, so it cannot make a snapshot partial.
B114's partial-snapshot machinery stays exactly as it is for the paths the set
*does* claim — if `content/` will not read, that is still a failure and still
must be, because `content/originals` exists nowhere else.

**The env file travels, minus the key to the backup itself.** Everything
needed to rebuild the service goes in; `RESTIC_PASSWORD` is stripped, because
a backup containing the password that decrypts it is no use to somebody who
has only the backup, and is a wider blast radius if the repository leaks. That
one secret is the operator's to keep elsewhere, and `docs/runbook.md` must say
so in the restore procedure rather than in a comment.

Generated output stays out: `postcards/`, `photobooks/` and `mail/`. The
orders are rows in Postgres and the sources are in `content/`, so what is lost
is a PDF that can be produced again. Mail was already excluded by B636 and for
a stronger reason — it is plaintext sign-in codes.

Expected size: **about 555 MiB**, before restic's own deduplication.

## The second destination

The repository gains a copy on Proton Drive, and the shape of that addition
matters more than the destination does.

`restic backup` runs once, against the primary repository, exactly as now.
Then `restic copy --from-repo <primary>` moves that snapshot into
`rclone:protondrive:…`. Copy rather than a second backup run: it preserves
deduplication, it reads the snapshot that was just verified, and it cannot
corrupt the primary.

**The primary alone decides whether the night succeeded.** Proton gets its own
stamp and its own line in `/api/health`, and a week of Proton failures makes
health *say so* without turning the backup red. This is not caution about
Proton in particular. It is what B651 cost: an alert that fires every night is
an alert nobody reads, and the next real failure arrives into a channel that
has been crying wolf. A destination that cannot take the service down is a
destination that can be added without asking anybody to trust it yet.

`rclone`'s `protondrive` backend is **Beta and reverse-engineered from an
API Proton does not publish**. That is the reason the primary stays, the
reason Proton is a copy rather than a move, and the reason step 2 of the Order
below is a spike with permission to fail.

**Retention goes to `--keep-daily 30`** on both, from 14.

### The credential, which is a decision and not a detail

rclone cannot use Proton's browser login. It needs a username, an obscured
password, and — where the account has 2FA — `RCLONE_PROTONDRIVE_OTP_SECRET_KEY`,
which is the TOTP **seed** rather than a code. Anyone who reads
`/etc/fernscout/env` can then generate that account's codes indefinitely.

So the account on the VPS is a **dedicated Proton account** holding nothing
but this repository. Storing a personal account's TOTP seed on a public web
server is a trade that is fine until the day the web server is the thing that
went wrong.

## What is deliberately not here

- **No verification that a restore works.** `docs/runbook.md` has a restore
  drill and it is still the only thing that proves any of this; W42 updates it
  for the new layout and does not automate it. A drill nobody runs is not
  improved by scripting it.
- **No second alert channel for Proton.** Health reports it; nothing pages.
  Add one when Proton has earned being on the critical path.
- **No change to `restic`.** It keeps the encryption, the deduplication, the
  retention and the integrity check. Only where the bytes land is new.

## Order

1. **Rescope the set, and capture the env file.** No Proton, no rclone. This
   is the whole of the DR gap and forty per cent of the size, and it is
   worth landing alone. Closes B651 as a side effect of the allowlist.
2. **Spike rclone against a dedicated Proton account.** Does restic's
   `rclone:` backend drive it, how long does 555 MiB take, and does a
   `restic check` pass against what lands? **Permission to conclude no** — the
   backend is Beta, and step 1 has already been banked.
3. **Wire the copy, the second stamp and the health line**, only if 2 said
   yes.
4. **The runbook.** Restore into a clean machine from the new layout,
   including recreating `/etc/fernscout/env` from `env/fernscout.env` and
   supplying `RESTIC_PASSWORD` by hand. Update the timed drill.
