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
#   BACKUP_INIT_IF_MISSING  default: 0. With 1, a missing repository is created
#                         instead of refused. Off for the nightly timer on
#                         purpose — see step 4.
#   APP_DIR               default: the directory this script lives in, minus
#                         /scripts
#
# On the way out of a run that finished, the ISO-8601 time is written to
# $DATA_DIR/.backup-last-success. That file is the only thing outside the
# journal that knows a backup worked; /api/health reads it (lib/backupStatus.ts)
# and deploy/fernscout-alert@.service writes the matching .backup-last-failure.
#
# A file that cannot be read is *not* allowed to cost the night's backup, and
# is *not* allowed to pass for a success either — see `stage_tree` below (B114).

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

# --- Staging a tree when part of it will not read (B114) -------------------
#
# `cp -a "$src/." "$dest/"` used to be one line, and under `set -e` one file
# the service user could not read ended the run: a root-owned stray an
# operator left behind, a socket, a file caught mid-rotation. Nothing had been
# pushed at that point, so a night's backup was lost to a file nobody needed —
# and `content/` originals exist nowhere else.
#
# The other obvious fix — refuse to start unless every byte under DATA_DIR
# reads — was considered and rejected. It has the same outcome (no snapshot
# tonight) for the same trivial cause, only earlier. So:
#
#   1. `cp` keeps going. It already does: it copies what it can, reports the
#      rest on stderr and exits non-zero, and here that status is tolerated.
#   2. Whatever did not make it is named, path by path, in the journal. That
#      is the part that did not exist before at all.
#   3. It is counted, and a run that skipped anything is NOT a success: no
#      `.backup-last-success` stamp and a non-zero exit, so the unit's
#      `OnFailure=` alert fires and /api/health reports `backup.state:
#      "failing"`. The snapshot is still pushed first, and tagged `partial`.
#
# That is deliberately both halves. What is under DATA_DIR should all be
# readable (the runbook's ownership rule), so an unreadable file is an
# operator error somebody has to fix and the run says so by failing — but it
# says so *after* saving everything it could, not instead of.
SKIPPED_TOTAL=0

# Every path under $1, relative and sorted. An unreadable directory cannot be
# descended into, so what is inside one is not in this list — which is exactly
# why `unreadable_paths` looks at directories themselves.
list_tree() (
  cd "$1" 2>/dev/null || exit 0
  find . -mindepth 1 2>/dev/null | LC_ALL=C sort || true
)

# Every path under $1 this user cannot read. `-exec test -r` rather than GNU
# find's `-readable`, because BSD find — macOS, where the test suite runs —
# does not have the latter. Symlinks are excluded: `test -r` follows them, and
# a broken link is not an unreadable file.
unreadable_paths() (
  cd "$1" 2>/dev/null || exit 0
  find . -mindepth 1 ! -type l ! -exec test -r {} \; -print 2>/dev/null | LC_ALL=C sort || true
)

# stage_tree <label> <source> <destination>
stage_tree() {
  local label="$1" src="$2" dest="$3"
  mkdir -p "$dest"

  # Taken *before* the copy on purpose. A file the app creates while the copy
  # is running would otherwise look like one the copy failed to take.
  local before
  before="$(list_tree "$src")"

  local cp_error="" cp_status=0
  cp_error="$(cp -a "$src/." "$dest/" 2>&1 >/dev/null)" || cp_status=$?

  if (( cp_status == 0 )); then
    return 0
  fi

  # cp's own words first: they say *why*, which a tree comparison cannot.
  log "WARNING: cp exited $cp_status staging $label — it copies what it can and reports the rest:"
  while IFS= read -r line; do
    if [[ -n "$line" ]]; then log "WARNING:   $line"; fi
  done <<< "$cp_error"

  # cp copies a directory's mode even when it could not read what was inside
  # it, so an unreadable source directory can leave an unreadable one sitting
  # in the staging copy — which the EXIT trap's `rm -rf "$STAGING_DIR"`, and
  # then tomorrow's, would trip over. Directories only, and only on this path:
  # nothing rewrites the modes of a run that copied cleanly.
  find "$dest" -type d ! -perm -0700 -exec chmod u+rwx {} + 2>/dev/null || true

  # Two nets, because neither alone is enough. The readability scan catches an
  # unreadable *directory*, which cp creates empty at the destination so a tree
  # comparison sees nothing wrong. The tree comparison catches everything else
  # that failed to copy — a socket, a device node, a full disk — without
  # anybody having to parse cp's platform-specific wording.
  local candidates=""
  candidates="$( { unreadable_paths "$src"; comm -23 <(printf '%s\n' "$before") <(list_tree "$dest"); } | LC_ALL=C sort -u )" || true

  local filtered="" rel abs
  while IFS= read -r rel; do
    if [[ -z "$rel" ]]; then continue; fi
    abs="$src/${rel#./}"
    # Gone between the copy and now: a temp file the app wrote and renamed
    # away. That is not a file this run failed to back up.
    if [[ ! -e "$abs" && ! -L "$abs" ]]; then continue; fi
    filtered="$filtered$abs"$'\n'
  done <<< "$candidates"

  local missing=0
  if [[ -n "$filtered" ]]; then
    missing="$(printf '%s' "$filtered" | wc -l | tr -d ' ')"
  fi
  if (( missing == 0 )); then
    log "WARNING: cp reported an error but every path under $label is present in the staged copy"
    return 0
  fi

  log "WARNING: $missing path(s) under $label could not be staged and are NOT in tonight's snapshot:"
  local shown=0
  while IFS= read -r abs; do
    if [[ -z "$abs" ]]; then continue; fi
    if (( shown >= 25 )); then
      log "WARNING:   … and $(( missing - shown )) more"
      break
    fi
    if [[ -d "$abs" ]]; then
      log "WARNING:   $abs  (a directory — its contents could not even be listed, so what is inside it is unknown)"
    else
      log "WARNING:   $abs"
    fi
    shown=$(( shown + 1 ))
  done <<< "$filtered"

  SKIPPED_TOTAL=$(( SKIPPED_TOTAL + missing ))
}

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
  stage_tree "DATA_DIR" "$DATA_DIR" "$STAGING_DIR/data"
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
  stage_tree "content/" "$CONTENT_DIR" "$STAGING_DIR/content"
else
  log "WARNING: content dir ($CONTENT_DIR) does not exist"
fi

# --- 4. Push to off-VPS storage with restic --------------------------------
#
# The probe, and why it is this careful (B63).
#
# There are two ways to fail to find a repository and they want opposite
# responses, and the old `if ! restic snapshots; then restic init; fi` could
# tell them apart only by accident:
#
#   absent       nothing is there. A first run — or `RESTIC_REPOSITORY` has a
#                typo in it, in which case `restic init` makes a brand new
#                empty repository, backs into it, prunes it and exits 0. A
#                green backup protecting nothing, while every real snapshot
#                sits in the repository nobody is writing to any more.
#   unreachable  something is there, or might be, and we cannot see it:
#                permission denied, wrong password, connection refused, DNS.
#                `restic init` here dies on "config file already exists" if we
#                are lucky, and overwrites nothing if we are not.
#
# Both happened on the live server the same night: the repository was
# root-owned while the service runs as `fernscout`, the probe read
# permission-denied as "not initialised yet", and init collided with the
# config that was there all along.
#
# `restic cat config` is the question actually being asked ("is there a
# repository here I can read?"), and since restic 0.17 its exit status answers
# it structurally: 10 = repository does not exist, 12 = wrong password, 0 =
# yes. The text fallback below is for older restic — Debian 12 ships 0.14 —
# and it is written to fail *towards* `unreachable`, because that is the
# direction that refuses to create anything.
#
# Logged *before* the call, not after: this is the first thing that touches the
# repository, and an unreachable one makes restic retry with exponential
# backoff for minutes. Without this line the journal shows the staging lines,
# then nothing at all, and the only bound is TimeoutStartSec=30min.
log "checking the repository at $RESTIC_REPOSITORY (first call to reach it — a long pause here means it cannot be)"
probe_error=""
probe_status=0
probe_error="$(restic cat config 2>&1 >/dev/null)" || probe_status=$?

if (( probe_status == 0 )); then
  repo_state="present"
elif (( probe_status == 10 )); then
  repo_state="absent"
elif (( probe_status == 12 )); then
  repo_state="unreachable"   # wrong password: something IS there, we cannot open it
else
  # restic < 0.17 returns 1 for everything. Read the message instead, checking
  # the "cannot see it" wordings first: "unable to open config file: … :
  # permission denied" contains a phrase the absent list would otherwise match.
  shopt -s nocasematch
  if [[ "$probe_error" =~ (permission[[:space:]]denied|access[[:space:]]denied|wrong[[:space:]]password|no[[:space:]]key[[:space:]]found|connection[[:space:]]refused|no[[:space:]]route[[:space:]]to[[:space:]]host|timeout|timed[[:space:]]out|unauthorized|forbidden|invalidaccesskey|signaturedoesnotmatch|no[[:space:]]such[[:space:]]host) ]]; then
    repo_state="unreachable"
  elif [[ "$probe_error" =~ (repository[[:space:]]does[[:space:]]not[[:space:]]exist|no[[:space:]]such[[:space:]]file[[:space:]]or[[:space:]]directory|specified[[:space:]]key[[:space:]]does[[:space:]]not[[:space:]]exist|nosuchkey|nosuchbucket) ]]; then
    repo_state="absent"
  else
    # An error nobody has classified is not evidence of absence.
    repo_state="unreachable"
  fi
  shopt -u nocasematch
fi

created_repository=0
case "$repo_state" in
  present)
    log "repository is there and readable"
    ;;

  unreachable)
    log "ERROR: cannot read the repository at $RESTIC_REPOSITORY (restic exit $probe_status)"
    log "ERROR: restic said: ${probe_error:-no output}"
    log "ERROR: this is not 'no repository yet', it is 'no answer' — refusing to run 'restic init' over it."
    log "ERROR: the usual causes, in order: the repository is owned by another user (it must be owned by the user this unit runs as), RESTIC_PASSWORD is wrong, or the storage is unreachable."
    exit 1
    ;;

  absent)
    log "WARNING: there is no repository at $RESTIC_REPOSITORY (restic exit $probe_status)"
    if [[ "${BACKUP_INIT_IF_MISSING:-0}" == "1" ]]; then
      log "WARNING: BACKUP_INIT_IF_MISSING=1 — creating a NEW, EMPTY repository at $RESTIC_REPOSITORY"
      log "WARNING: nothing taken before now is in it. If you did not mean to start over, stop this run and check RESTIC_REPOSITORY."
      restic init
      created_repository=1
    else
      # The default, and the whole point of B63: the nightly timer never
      # creates a repository, because a repository it created is by definition
      # not the one holding the backups.
      log "ERROR: refusing to create one. A typo in RESTIC_REPOSITORY otherwise becomes a new empty repository that backs up, prunes and exits 0 — a green backup that protects nothing."
      log "ERROR: if this really is the first run, initialise it once by hand:"
      log "ERROR:     sudo -u fernscout env RESTIC_REPOSITORY=\"$RESTIC_REPOSITORY\" RESTIC_PASSWORD=… restic init"
      log "ERROR: or re-run this script once with BACKUP_INIT_IF_MISSING=1."
      exit 1
    fi
    ;;
esac

log "backing up to $RESTIC_REPOSITORY"
# A snapshot that is missing paths still goes off-site — half the journal
# beats none of it — but it is labelled, so `restic snapshots` answers "was
# this one complete?" years later without anybody having the journal to hand.
partial_tag=()
if (( SKIPPED_TOTAL > 0 )); then
  log "WARNING: this snapshot is incomplete ($SKIPPED_TOTAL path(s) missing) and will be tagged 'partial'"
  partial_tag=(--tag partial)
fi
restic backup "$STAGING_DIR" \
  --tag fernscout \
  ${partial_tag[@]+"${partial_tag[@]}"} \
  --host "${HOSTNAME:-fernscout-vps}"

log "pruning snapshots older than ${BACKUP_KEEP_DAILY} daily generations"
restic forget --tag fernscout --keep-daily "$BACKUP_KEEP_DAILY" --prune

# --- 4b. Does this repository hold what somebody thinks it holds? ----------
# The probe above catches a path that is empty. It cannot catch a path that
# happens to hold a *different* repository the credentials can read — an old
# one, a neighbouring prefix in the same bucket — which reads as `present` and
# backs up perfectly into the wrong place. Counting is the cheap check: a
# repository the operator believes has fourteen nightly snapshots and which
# holds one has something wrong with it, and the count is in the journal
# either way so "it was one every night since March" is answerable later.
snapshot_count="$(restic snapshots --tag fernscout --no-lock --json 2>/dev/null | grep -o '"short_id"' | wc -l | tr -d ' ')" || snapshot_count=""
if [[ -n "$snapshot_count" ]]; then
  log "$snapshot_count snapshot(s) tagged fernscout in this repository"
  if (( snapshot_count <= 1 )); then
    if (( created_repository )); then
      log "WARNING: one snapshot, in the repository this run just created. Expected for a genuine first run, and exactly what a wrong RESTIC_REPOSITORY looks like too."
    else
      log "WARNING: this repository holds ${snapshot_count} snapshot(s) after a successful run. If you expected the last ${BACKUP_KEEP_DAILY} nights, this is not the repository you meant."
    fi
  fi
fi

# --- 4c. Did everything actually get in? -----------------------------------
# Everything that could be saved is now off-site, which is the whole reason
# staging tolerates an unreadable file rather than aborting on one. What must
# not follow is a green light: a snapshot missing paths is not the backup
# anybody thinks they have, and the only place that shows is here.
if (( SKIPPED_TOTAL > 0 )); then
  log "ERROR: the snapshot was pushed, but $SKIPPED_TOTAL path(s) are missing from it — the WARNING lines above name every one."
  log "ERROR: not recording this run as a success: no .backup-last-success stamp, and a non-zero exit so the unit's OnFailure= alert fires and /api/health reports backup.state=failing."
  log "ERROR: everything under DATA_DIR and content/ must be readable by the user this unit runs as (usually 'fernscout'). Fix the ownership on the paths above and re-run."
  exit 1
fi

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
