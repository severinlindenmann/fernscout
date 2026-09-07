---
id: B659
title: The only backup is on the machine it is backing up
type: CHORE
priority: medium
complexity: medium
area: backup, DR, off-site
found: "2026-09-07T06:19:24Z"
started: "2026-09-07T12:24:00Z"
merged: "2026-09-07T12:49:35Z"
---

# B659 — The only backup is on the machine it is backing up

## Why

`RESTIC_REPOSITORY=/var/backups/fernscout` — a directory on the same VPS as
`DATA_DIR` and `content/`. The nightly run is real, restic's encryption and
retention are real, and none of it survives the machine. Losing the VPS —
hardware, a compromise, a closed account, a mistaken `rm` at the wrong
path — takes the journals and every snapshot of them in one go.

What it *does* protect against is worth naming, because it is not nothing:
somebody deleting a trip, a bad ingest, a corrupt write. That is the failure
this has always covered and still covers.

Space is not the constraint: 671 GB free, and the repository is 966 MB.

W42 proposed Proton Drive as the second destination and the operator dropped
it on 2026-09-07 (B654, B655, both superseded) — the shape of the addition
was right and the destination was not. A cheap S3-compatible bucket is the
expected answer.

## Work

- Add a second destination, keeping W42's shape, which is the part worth
  reusing: `restic backup` to the local repository as now, then `restic copy
  --from-repo` into the remote. **The local repository alone decides whether
  the night succeeded**; the remote gets its own stamp and its own line in
  `/api/health`, and a stale remote says so without turning the backup red.
  B651 is why: an alert that fires every night is one nobody reads.
- Pick the bucket. Backblaze B2 and Hetzner object storage are both plausible
  at this size; the script's own header already carries a B2 example.
- The credential goes in `/etc/fernscout/env`, which since B653 travels in the
  backup — so an object-storage key that can *delete* is a key that can delete
  the copy an attacker just found. Use an append-only or write-only key where
  the provider offers one, and say in the task which you used.
- 30 dailies remotely, matching local.

## Acceptance

- A night lands in both, and `restic check` passes against the remote.
- With the remote credentials deliberately wrong, the unit exits zero,
  `/api/health` reports the backup ok with a stale secondary, and no alert
  fires.
- `docs/runbook.md` says which repository to restore from and that either
  answers.

## Built, 2026-09-07 — the checkout half

**Which bucket, which key: left to the operator, on purpose.** This lands the
mechanism and everything up to that line, not a provider choice — that needs
an account, a cost and a credential this session cannot create. See "What the
operator still has to do" below.

**`scripts/backup.sh`** — new step 8d, after the primary's `restic backup` +
`restic forget --prune` and after the SKIPPED_TOTAL/partial check, so a
partial or failed primary night is never copied off-site. Reads
`RESTIC_REPOSITORY_SECONDARY`; absent means the script runs exactly as before
(no new step, no new stamp, no new log line) — the "absent rather than
broken" rule for an optional capability. When set:

- `restic copy --from-repo "$RESTIC_REPOSITORY" --repo "$RESTIC_REPOSITORY_SECONDARY" --tag fernscout --host …`
  reads the snapshot the primary just verified and writes it to the secondary,
  keeping restic's own deduplication and unable to touch the primary.
- Same `RESTIC_PASSWORD` for both, per B655's call — no second secret to keep.
  The source side needed a password too, and the obvious `--from-password-command
  'echo "$RESTIC_PASSWORD"'` is **wrong**: restic 0.19.1 execs a
  `--from-password-command`/`--password-command` directly with no shell in
  between, so `$RESTIC_PASSWORD` in that string is never expanded and restic
  reads the literal four characters `$RESTIC_PASSWORD` as the password —
  "wrong password or no key found" even though the real password matched on
  both sides. Confirmed by hand against a real restic before writing the
  test. `--from-password-command 'printenv RESTIC_PASSWORD'` needs no shell
  and reads the value the parent process already exported.
- On success: `restic forget --tag fernscout --keep-daily "$BACKUP_KEEP_DAILY" --prune`
  against the secondary too, then `date -u … > $DATA_DIR/.backup-last-success-secondary`.
  "30 dailies remotely, matching local" is implemented as literally reusing
  `BACKUP_KEEP_DAILY` for both repositories rather than adding a second
  retention variable — whatever the operator sets locally is what the
  secondary matches, with nothing new to keep in step. (The default is still
  14, unchanged; set `BACKUP_KEEP_DAILY=30` if 30 is wanted, and it then
  applies to both.)
- Any failure at any point in 8d (copy or the secondary prune) is caught by an
  `if`, logged as a `WARNING:`, and changes nothing else: exit status,
  `.backup-last-success`, and the `OnFailure=`/`OnSuccess=` alert are all the
  primary's alone (B651's rule, reused rather than re-argued).

**`lib/backupStatus.ts`** — `secondarySuccessStampPath()`, and
`BackupStatus.secondary: SecondaryBackupStatus` with its own three-state
machine (`ok` / `stale` / `unknown`, **never** `failing` — there is no
secondary failure stamp and nothing pages on it). `unknown` covers both "never
configured" and "configured but never copied yet" without distinguishing
them, which is deliberately the same shape `state: "unknown"` already has for
the primary. Age and staleness use the same `BACKUP_MAX_AGE_HOURS` window as
the primary.

**`app/api/health/route.ts`** needed no change — it already spreads whatever
`readBackupStatus()` returns under `backup`, so `backup.secondary` appeared
for free.

**`.env.example`, `docs/runbook.md`, `docs/disaster-recovery.md`** — the new
variable documented where the others are, a new "The off-site copy (B659)"
section in the runbook with the exact commands to turn it on, the `/api/health`
example JSON updated to show `backup.secondary`, and disaster-recovery.md
points at `RESTIC_REPOSITORY_SECONDARY` as an equally-valid restore source
when the primary machine (and its local repository) is what was lost.

**Tests** — `test/backup-script.test.ts` (needs `restic` installed; skips
loudly otherwise, same as the rest of the file):
- not configured: `runBackup()` with no `RESTIC_REPOSITORY_SECONDARY` — status
  0, stdout never mentions "secondary repository", no
  `.backup-last-success-secondary` written. This is the degrade-cleanly case.
- configured and reachable: snapshot lands in the secondary repository,
  `restic check` against it passes, the stamp file is written with an
  ISO-8601 timestamp.
- configured with the wrong password (a secondary repo initialised under a
  different `RESTIC_PASSWORD`): run still exits 0 and still logs "done", a
  `WARNING: copying to the secondary repository … failed` line appears, and
  no secondary stamp is written. This is the acceptance line about wrong
  remote credentials.

`test/backup-status.test.ts`: a `describe("secondary", …)` block — no stamp is
`unknown` with a reason naming `RESTIC_REPOSITORY_SECONDARY`; a recent stamp is
`ok` independent of the primary's own age; an old stamp is `stale` without
moving the primary's `state`; and a failing primary alongside a healthy
secondary (or vice versa) never contaminates the other — the acceptance line
about the primary alone deciding whether the night succeeded, and about no
alert firing over the secondary. Plus one `/api/health` assertion that an
unconfigured instance reports `backup.secondary.state === "unknown"`.

`npm run verify`: full pass — build, tsc, eslint, vitest (4465 passed, 3
skipped — the two Postgres-only tests and one root-only permission test,
same skips this suite always has locally).

### What the operator still has to do on the live server (not done here, and cannot be from a checkout)

1. **Pick a bucket at a different provider than wherever the primary
   eventually lives**, and its cost. Backblaze B2 and Hetzner Object Storage
   are both named in Why as plausible at ~1 GB; this session is not choosing
   for the operator.
2. **Create an application key that cannot delete**, where the provider
   offers one (append-only/write-only) — the reasoning for why is in the
   script header and `.env.example`.
3. Add to `/etc/fernscout/env`: `RESTIC_REPOSITORY_SECONDARY=<repo url>` plus
   whatever credential env vars that backend needs (e.g.
   `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for an S3-compatible one). Do
   **not** add a second `RESTIC_PASSWORD` — the existing one covers both.
4. Initialise it once by hand — the nightly run refuses to, same reasoning as
   the primary (B63): `RESTIC_REPOSITORY="$RESTIC_REPOSITORY_SECONDARY" restic init`.
5. Run `sudo systemctl start fernscout-backup` once and confirm:
   `RESTIC_REPOSITORY="$RESTIC_REPOSITORY_SECONDARY" restic snapshots` and
   `restic check` against it, then `curl -s https://<domain>/api/health | jq .backup`
   and check `.secondary.state` is `"ok"`.

None of the underlying B21 restore-drill or B65 install-the-primary work is
touched or assumed done by this ticket; it only adds the second destination on
top of whatever primary is already running.
