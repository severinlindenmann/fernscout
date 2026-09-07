# Disaster recovery

The machine is gone. This is how the journals come back.

Everything here was executed on 2026-09-07, against the snapshot the nightly
timer had just written, and the corrections are inline. A procedure nobody has
followed is a draft.

## Before anything: the one thing not in the backup

**`RESTIC_PASSWORD` is deliberately not in the snapshot** (B653). Everything
else the service needs is — `DATABASE_URL`, `SESSION_SECRET`, the VAPID pair,
`CONTACTS_ENCRYPTION_KEY`, the SMTP credentials, `FERNSCOUT_ADMIN_EMAIL` — all
of it travels in `env/fernscout.env`. The password that decrypts the
repository does not, because a backup carrying the key to itself is no use to
somebody holding only the backup.

So it lives wherever this instance's operator keeps secrets, and **if it is
lost, every snapshot is unreadable ciphertext and nothing below is possible.**
Confirm you have it before you need it:

```bash
sudo grep ^RESTIC_PASSWORD= /etc/fernscout/env    # while the machine still exists
```

The other thing worth knowing before the day arrives: on this instance
`RESTIC_REPOSITORY` is a **local path** (`/var/backups/fernscout`). That
protects against deleting something by accident and not against losing the
machine. B659 is the open task for an off-site copy.

## What a snapshot contains

Since B653 the backup is an allowlist, not "everything under `DATA_DIR`":

```
db/postgres.dump        a pg_dump custom archive, when the deployment is Postgres
db/fernscout.db         the SQLite file and its -wal/-shm, when it is not
content/                the journals, and originals that exist nowhere else
config/config.json      the instance config the app reads
state/<name>.json       reactions, push subscriptions — lib/store.ts's own files
env/fernscout.env       /etc/fernscout/env, minus RESTIC_PASSWORD
```

Not in it, on purpose: the npm cache, sent mail, generated postcards and
photobooks, and anything else anybody has left in `DATA_DIR`. Each skipped
entry is named in the run's log, one line each — **read that log when adding
something new to the server**, because the allowlist's failure mode is a new
thing silently excluded.

## Restoring onto a fresh machine

```bash
# 0. Steps 1–5 of the runbook's "First deploy", then put RESTIC_REPOSITORY and
#    RESTIC_PASSWORD in /etc/fernscout/env by hand. They are all you need to
#    read the repository; everything else arrives in step 5.
set -a; . /etc/fernscout/env; set +a

# 1. Restore. -E carries the restic credentials across sudo.
sudo -E restic restore latest --target /restore

# 2. The tree keeps the absolute path it was staged at, so find it once.
STAGED=$(sudo find /restore -maxdepth 4 -type d -name 'fernscout-backup-staging' | head -1)

# 3. restic restores as root; the steps below run as fernscout.
sudo chmod -R a+rX /restore

# 4. Database. Skip if this deployment has none; for SQLite, the file is
#    restored with DATA_DIR in step 6 and there is nothing to do here.
sudo -u postgres createdb fernscout -O fernscout || true
sudo -E -u fernscout pg_restore --dbname="$DATABASE_URL" --clean --if-exists \
  "$STAGED/db/postgres.dump"

# 5. The environment. This is the step that did not exist before B653, and
#    without it the service will not start — see the trap below.
sudo cp "$STAGED/env/fernscout.env" /etc/fernscout/env.restored
#    Merge by hand: keep the RESTIC_PASSWORD you supplied in step 0, take
#    everything else from the restored file. Then:
sudo chown root:fernscout /etc/fernscout/env && sudo chmod 640 /etc/fernscout/env

# 6. Journals, instance config and state.
sudo mkdir -p /var/lib/fernscout
sudo rsync -a "$STAGED/content/" /var/lib/fernscout/content/
sudo cp "$STAGED/config/config.json" /var/lib/fernscout/config.json
sudo rsync -a "$STAGED/state/" /var/lib/fernscout/ 2>/dev/null || true
sudo chown -R fernscout:fernscout /var/lib/fernscout

# 7. Build and start.
cd /srv/fernscout && sudo -u fernscout npm ci && sudo -u fernscout npm run build
sudo systemctl restart fernscout

# 8. Verify.
curl -s https://<domain>/api/health
```

**Do not rsync `$STAGED/content/` into `/srv/fernscout/content/`.** That is the
git checkout, not what the app reads; it leaves tracked files modified and the
next `git pull --ff-only` in `scripts/deploy.sh` refuses. Restore there only
where `CONTENT_DIR` is genuinely unset.

## The trap that ends a restore

**A restored service will not boot without step 5**, and the error names a
feature rather than the cause:

```
Some capabilities are enabled but not configured:
  - features.contacts is enabled but CONTACTS_ENCRYPTION_KEY is not set
```

That is `assertCapabilities` in `lib/capabilities.ts`, and it is the whole
argument for putting the env file in the backup. Before B653 the answer was to
reconstruct a dozen secrets from memory, and `CONTACTS_ENCRYPTION_KEY` is not
reconstructible at all — without the original, every stored contact address
stays encrypted and the invitations that reference them are gone.

## Rehearsing it without touching production

The drill below runs the whole service off restored bytes on a laptop. It is
the only thing that proves any of this, and it costs nothing.

```bash
# 1. Restore on the server into scratch, and copy it down.
ssh <host> 'sudo -E restic restore latest --target /var/tmp/dr-drill'
ssh <host> 'sudo chmod -R a+rX /var/tmp/dr-drill'
rsync -a <host>:/var/tmp/dr-drill/var/tmp/fernscout-backup-staging/ ./dr/

# 2. Run the app from those bytes, with the snapshot's own env.
set -a; source ./dr/env/fernscout.env; set +a
export CONTENT_DIR="$PWD/dr/content" DATA_DIR="$PWD/dr-data"
export DATABASE_URL="sqlite:$PWD/dr-data/fernscout.db"
export FERNSCOUT_CONFIG="$PWD/dr-data/instance-config.json"
npx next dev -p 3111
```

**Neutralise the outbound channels first, and this is not optional.** The
restored env carries live SMTP credentials and a real WhatsApp token, so a
restored copy run unmodified mails the journal's actual contacts. Take
`config/config.json` from the snapshot, set `mail.transport` to `file`, the
print providers to `dry-run` and `whatsapp.enabled` to false, save it as the
`FERNSCOUT_CONFIG` above, and `unset SMTP_* WHATSAPP_*` before starting.

Signing in locally needs no mailbox: with the file transport the code is
written as an `.eml` under `$DATA_DIR/mail/`, and the mail carries a one-click
`/s/<token>` link.

Restoring the Postgres dump locally needs a **Postgres 17** `pg_restore` — the
dump is a v1.16 custom archive and a v16 client refuses it with `unsupported
version (1.16) in file header`, which reads like corruption and is not.

## Drill record

- [x] **2026-09-01, native stack, ~35 seconds end to end.** Seeded 7 reaction
  rows, an uncommitted file under `content/`, and a 64 KiB
  `originals/DRILL.RAF` in neither git nor the export. Dropped the database,
  `rm -rf`'d `DATA_DIR`, restored. All three came back identical. `npm ci` and
  the build were 29 of the 35 seconds.

- [x] **2026-09-07, first drill against the B653 layout.** Restored 1487 files
  / 556 MiB in 1s; the dump restored into a scratch Postgres 17 with 5 users,
  14 sessions, 12 credit-ledger rows, 6 print orders, 2 contacts and 2 access
  grants; `env/fernscout.env` came back with 22 variables and no
  `RESTIC_PASSWORD`; the service booted from the restored tree and served
  journals, days and original photographs. The first boot **failed** on
  `CONTACTS_ENCRYPTION_KEY`, which is what put the trap above in this
  document. Database restored on the server rather than the laptop: no
  Postgres 17 client locally.
