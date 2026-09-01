#!/usr/bin/env bash
#
# Nightly backup: the database (if any), $DATA_DIR and content/, pushed
# off-VPS with restic. Run it from systemd on the VPS itself — see
# deploy/fernscout-backup.{service,timer}. It calls the locally installed
# Postgres dump and reads DATA_DIR/content straight off disk).
#
#   sudo systemctl start fernscout-backup      # one run, now
#   systemctl status fernscout-backup          # how the LAST run ended
#   systemctl list-timers fernscout-backup     # only when the NEXT one is due
#
# `list-timers` reports the schedule and never the result: a timer whose every
# run has aborted since March still prints a perfectly healthy next-elapse.
# `systemctl status` is the one that shows the last result, and
# `/api/health` -> `.backup` answers the same question from off the machine,
# out of the stamp file this script writes below.
#
# See docs/runbook.md for the restore procedure and the timed restore drill.
#
# Required env (systemd reads it from /etc/fernscout/env via EnvironmentFile):
#   RESTIC_REPOSITORY   e.g. s3:https://s3.eu-central-003.backblazeb2.com/fernscout-backups
#   RESTIC_PASSWORD     encrypts the repo; losing it means losing the backups
#   DATA_DIR            same directory the app writes to (reactions,
#                        push subscriptions, and — once W06 lands — the
#                        SQLite file at $DATA_DIR/fernscout.db)
# Optional:
#   DATABASE_URL         only dumped if it starts with postgres:// or
#                         postgresql://; sqlite:… needs nothing extra, the
#                         file already lives under DATA_DIR
#   CONTENT_DIR           default: <repo>/content
#   BACKUP_KEEP_DAILY     default: 14 — passed to `restic forget --prune`
#   APP_DIR               default: the directory this script lives in, minus
#                         /scripts
#
# On the way out of a run that finished, the ISO-8601 time is written to
# $DATA_DIR/.backup-last-success. That file is the only thing outside the
# journal that knows a backup worked; /api/health reads it (lib/backupStatus.ts)
# and deploy/fernscout-alert@.service writes the matching .backup-last-failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
CONTENT_DIR="${CONTENT_DIR:-$APP_DIR/content}"

: "${DATA_DIR:?DATA_DIR must be set to the same directory the app writes to}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set — see .env.example}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD must be set — see .env.example}"

BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
# A fixed path, not mktemp: restic stores the absolute path it was given, so
# a stable staging directory is what makes `restic restore latest --target
# /restore` land somewhere predictable (see docs/runbook.md) instead of
# under a different random tmp name every night.
STAGING_DIR="${BACKUP_STAGING_DIR:-/var/tmp/fernscout-backup-staging}"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
trap 'rm -rf "$STAGING_DIR"' EXIT

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

log "staging in $STAGING_DIR"

# --- 1. Database dump, if this deployment has one -------------------------
# The prototype tier (docs/ROADMAP.md §2.2) has no DATABASE_URL and Postgres is
# not even installed — that's not a failure, there is simply nothing to dump.
# The sqlite:… dialect needs no separate dump either: the file lives at
# $DATA_DIR/fernscout.db and is picked up by step 2 below.
if [[ "${DATABASE_URL:-}" == postgres://* || "${DATABASE_URL:-}" == postgresql://* ]]; then
  log "dumping Postgres with the local pg_dump"
  mkdir -p "$STAGING_DIR/db"
  # pg_dump reads the connection straight from DATABASE_URL, so there is no
  # second copy of the credentials to keep in step.
  if ! pg_dump -Fc --dbname="$DATABASE_URL" > "$STAGING_DIR/db/postgres.dump"; then
    log "ERROR: pg_dump failed — aborting before pushing a backup without a DB dump"
    exit 1
  fi
  log "dump written: $(du -h "$STAGING_DIR/db/postgres.dump" | cut -f1)"
else
  log "no Postgres DATABASE_URL set — skipping DB dump (sqlite, if any, is under DATA_DIR)"
fi

# --- 2. DATA_DIR (reactions, push subscriptions, sqlite file) -------------
if [[ -d "$DATA_DIR" ]]; then
  log "staging DATA_DIR ($DATA_DIR)"
  mkdir -p "$STAGING_DIR/data"
  cp -a "$DATA_DIR/." "$STAGING_DIR/data/"
else
  log "WARNING: DATA_DIR ($DATA_DIR) does not exist — nothing to back up there yet"
fi

# --- 3. content/ (the canonical, git-tracked trip data) --------------------
# Backed up anyway even though it's in git: an uncommitted edit made straight
# on the VPS (or media that was rsynced but never committed, see ROADMAP A9)
# is exactly the kind of state a "just re-clone the repo" recovery
# would silently lose.
if [[ -d "$CONTENT_DIR" ]]; then
  log "staging content/ ($CONTENT_DIR)"
  mkdir -p "$STAGING_DIR/content"
  cp -a "$CONTENT_DIR/." "$STAGING_DIR/content/"
else
  log "WARNING: content dir ($CONTENT_DIR) does not exist"
fi

# --- 4. Push to off-VPS storage with restic --------------------------------
# Logged *before* the call, not after: this is the first thing that touches the
# repository, and an unreachable one makes restic retry with exponential
# backoff for minutes. Without this line the journal shows the staging lines,
# then nothing at all, and the only bound is TimeoutStartSec=30min.
log "checking the repository at $RESTIC_REPOSITORY (first call to reach it — a long pause here means it cannot be)"
probe_error=""
probe_status=0
probe_error="$(restic snapshots --no-lock 2>&1 >/dev/null)" || probe_status=$?

if (( probe_status != 0 )); then
  # Kept, not discarded. `>/dev/null 2>&1` here is what made a stalled run
  # illegible in the journal, and what left 'restic init' as the only
  # explanation offered for a repository that was merely unreadable.
  log "repository probe failed (exit $probe_status): ${probe_error:-no output}"
  log "repository not initialised yet — running 'restic init'"
  restic init
fi

log "backing up to $RESTIC_REPOSITORY"
restic backup "$STAGING_DIR" \
  --tag fernscout \
  --host "${HOSTNAME:-fernscout-vps}"

log "pruning snapshots older than ${BACKUP_KEEP_DAILY} daily generations"
restic forget --tag fernscout --keep-daily "$BACKUP_KEEP_DAILY" --prune

# --- 5. Record that it worked ----------------------------------------------
# The last line of a successful run, deliberately: everything above it can
# still exit non-zero, and a stamp written early would say a backup succeeded
# that never pushed a snapshot. Written to DATA_DIR because that is the one
# directory both this script and the app agree on, which is what lets
# /api/health read it.
#
# It is therefore *inside* the snapshot, but written after it: every snapshot
# carries the previous run's stamp, and a restored instance reports its
# second-to-last backup rather than its last. One night out of date and honest
# beats the alternative, which is a restored instance claiming a backup it
# cannot have taken.
if [[ -d "$DATA_DIR" ]]; then
  date -u +%FT%TZ > "$DATA_DIR/.backup-last-success"
  log "recorded success in $DATA_DIR/.backup-last-success"
else
  log "WARNING: DATA_DIR ($DATA_DIR) does not exist — cannot record the success stamp /api/health reads"
fi

log "done"
