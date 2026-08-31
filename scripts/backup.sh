#!/usr/bin/env bash
#
# Nightly backup: the database (if any), $DATA_DIR and content/, pushed
# off-VPS with restic. Run it from systemd on the VPS itself — see
# deploy/fernscout-backup.{service,timer}. It calls the locally installed
# Postgres dump and reads DATA_DIR/content straight off disk).
#
#   sudo systemctl start fernscout-backup      # one run, now
#   systemctl list-timers fernscout-backup     # when the next one is due
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
if ! restic snapshots >/dev/null 2>&1; then
  log "repository not initialised yet — running 'restic init'"
  restic init
fi

log "backing up to $RESTIC_REPOSITORY"
restic backup "$STAGING_DIR" \
  --tag fernscout \
  --host "${HOSTNAME:-fernscout-vps}"

log "pruning snapshots older than ${BACKUP_KEEP_DAILY} daily generations"
restic forget --tag fernscout --keep-daily "$BACKUP_KEEP_DAILY" --prune

log "done"
