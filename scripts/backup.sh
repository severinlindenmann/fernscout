#!/usr/bin/env bash
#
# Nightly backup: an explicit allowlist of what this instance cannot recreate
# on its own, pushed off-VPS with restic. Run it from systemd on the VPS
# itself — see deploy/fernscout-backup.{service,timer}.
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
# --- The backup set (W42, B653) ---------------------------------------------
# An explicit allowlist, not "everything under DATA_DIR minus what somebody
# remembered to subtract" — that shape grew by default: an npm cache and a
# stray tarball were forty per cent of one night's snapshot, and two
# root-owned files nobody needed made two more nights fail (B651). The layout
# a snapshot holds is now fixed:
#
#   db/postgres.dump        the pg_dump, when DATABASE_URL is postgres://…
#   db/fernscout.db         the SQLite file DATABASE_URL=sqlite:… points at
#                            (lib/db/url.ts), plus its -wal/-shm sidecars if
#                            present. Staged with `sqlite3 .backup` where that
#                            binary is on PATH — a transactionally consistent
#                            snapshot safe to take while the app keeps writing
#                            — and with a plain file copy otherwise, which is
#                            CRASH-CONSISTENT ONLY; see stage_sqlite below.
#   content/                CONTENT_DIR, staged HERE regardless of where it
#                            physically sits. On a deployment where CONTENT_DIR
#                            is nested inside DATA_DIR this used to land at
#                            data/content instead — that no longer happens,
#                            because DATA_DIR itself is not staged wholesale
#                            any more. Generated per-trip output
#                            (content/<user>/postcards, .../photobooks) is
#                            stripped back out after staging: the orders are
#                            rows in the database and the photographs are
#                            already in content/, so what is lost is a PDF
#                            that can be produced again. Since B636 mail lives
#                            under DATA_DIR (mail/), outside CONTENT_DIR, so it
#                            is never staged here at all — but a deployment
#                            that has not migrated can still have plaintext
#                            .eml under content/.mail/ or content/<user>/mail/
#                            left from before that move (B662), and those are
#                            stripped back out the same way postcards and
#                            photobooks are.
#   config/config.json      $DATA_DIR/config.json
#   state/<name>.json       every OTHER top-level *.json file under DATA_DIR
#                            — the convention `lib/store.ts` writes to
#                            (`readStore`/`updateStore`, `<name>.json` at the
#                            root of DATA_DIR: reactions.json,
#                            push-subscriptions.json today, and whatever the
#                            next store calls itself). This is deliberately a
#                            pattern rather than two hardcoded names, so a new
#                            store lib/store.ts adds is backed up without this
#                            script changing — see stage_json_stores below for
#                            why that is still an allowlist and not a return
#                            to subtraction.
#   env/fernscout.env       $ENV_FILE (default /etc/fernscout/env), with
#                            RESTIC_PASSWORD stripped — see step 6 below.
#
# Every top-level entry under DATA_DIR that is none of the above is named on
# stdout as skipped, on every run — see "Say what else is under DATA_DIR"
# below. That line is what makes it safe to grow this set by naming things
# rather than by exception: a new directory that matters gets one line of
# output per night until somebody adds it here.
#
# Required env (systemd reads it from /etc/fernscout/env via EnvironmentFile):
#   RESTIC_REPOSITORY   e.g. s3:https://s3.eu-central-003.backblazeb2.com/fernscout-backups
#   RESTIC_PASSWORD     encrypts the repo; losing it means losing the backups
#   DATA_DIR            same directory the app writes to: config.json, the
#                        sqlite file and its own JSON stores when that is the
#                        dialect, and the backup stamp files
# Optional:
#   DATABASE_URL         postgres://… is dumped with pg_dump; sqlite:… is
#                         staged from DATA_DIR/fernscout.db (see db/ above);
#                         unset means no database dump at all, and the app's
#                         state lives entirely in the JSON stores instead
#   CONTENT_DIR           default: <repo>/content
#   ENV_FILE              default: /etc/fernscout/env — staged as
#                         env/fernscout.env, RESTIC_PASSWORD stripped
#   BACKUP_KEEP_DAILY     default: 14 — passed to `restic forget --prune`,
#                         against BOTH repositories when a secondary is
#                         configured (B659) — "matching local" is this script
#                         reusing the one number rather than tracking two.
#   BACKUP_INIT_IF_MISSING  default: 0. With 1, a missing repository is created
#                         instead of refused. Off for the nightly timer on
#                         purpose — see step 8.
#   RESTIC_REPOSITORY_SECONDARY  a second, off-site restic repository (B659 —
#                         the machine backing up and the only copy of the
#                         backup must not be the same machine). Unset means
#                         exactly what it did before this existed: one
#                         destination, nothing more attempted. When set, step
#                         8d pushes what the primary just backed up on to it
#                         with `restic copy --from-repo`, which keeps
#                         deduplication, reads the snapshot the primary has
#                         already decided is good, and cannot corrupt it.
#                         Encrypted with the SAME `RESTIC_PASSWORD` as the
#                         primary — one secret to keep, not two — so no new
#                         password variable exists to set. A failure here
#                         (wrong credentials, unreachable storage) is logged
#                         and never fails the run, never blocks
#                         `.backup-last-success`, and never touches the
#                         primary: the primary alone decides whether the night
#                         succeeded (B651 — an alert that fires every night is
#                         one nobody reads). Its own freshness is
#                         `.backup-last-success-secondary`, read by
#                         `/api/health` -> `.backup.secondary`
#                         (lib/backupStatus.ts).
#   APP_DIR               default: the directory this script lives in, minus
#                         /scripts
#
# On the way out of a run that finished, the ISO-8601 time is written to
# $DATA_DIR/.backup-last-success. That file is the only thing outside the
# journal that knows a backup worked; /api/health reads it (lib/backupStatus.ts)
# and deploy/fernscout-alert@.service writes the matching .backup-last-failure.
#
# A file that cannot be read is *not* allowed to cost the night's backup, and
# is *not* allowed to pass for a success either — see `stage_tree` below
# (B114). That machinery now only guards the paths this set actually claims:
# an unreadable file under content/ still makes the run fail, exactly as
# before. An unreadable stray anywhere else under DATA_DIR is simply not
# staged at all — it is named in the skipped-entries log and has no bearing
# on whether the run succeeds (B651).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
CONTENT_DIR="${CONTENT_DIR:-$APP_DIR/content}"
ENV_FILE="${ENV_FILE:-/etc/fernscout/env}"

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
# That is deliberately both halves. What this set claims should all be
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

# is_inside <child> <ancestor> — true when <child> is <ancestor> or sits under
# it. Both are resolved first, so a symlinked CONTENT_DIR is answered by where
# it points rather than by how it was spelled. Used below only to keep the
# skipped-entries log from naming CONTENT_DIR as skipped when it happens to
# sit inside DATA_DIR — it is not skipped, it is staged as content/ by step 2.
is_inside() {
  local child ancestor
  child="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  ancestor="$(cd "$2" 2>/dev/null && pwd -P)" || return 1
  [[ "$child" == "$ancestor" || "$child" == "$ancestor"/* ]]
}

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
  # `LC_ALL=C` on comm, not only on the sorts that feed it. Both producers
  # already sort that way; a comm collating in the unit's locale
  # (systemd hands it LANG=en_US.UTF-8) calls that input unsorted and answers
  # with a wrong difference in both directions — it named a readable
  # `config.json.bak-…` as missing on the VPS, and the same disorder can drop a
  # genuinely unreadable file out of the list, which is a snapshot reported
  # complete when it is not. B450.
  candidates="$( { unreadable_paths "$src"; LC_ALL=C comm -23 <(printf '%s\n' "$before") <(list_tree "$dest"); } | LC_ALL=C sort -u )" || true

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

# stage_file <label> <source> <destination> — the single-file counterpart to
# stage_tree, for the two files in the set that are not directories. Same two
# outcomes as stage_tree, simplified because there is no tree to diff: absent
# is only ever a WARNING (there was nothing to lose), unreadable counts toward
# SKIPPED_TOTAL because — unlike a stray beside it — this file IS the set.
stage_file() {
  local label="$1" src="$2" dest="$3"
  if [[ ! -e "$src" ]]; then
    log "WARNING: $label ($src) does not exist"
    return 0
  fi
  if [[ ! -r "$src" ]]; then
    log "WARNING: $label ($src) could not be staged (not readable) and is NOT in tonight's snapshot"
    SKIPPED_TOTAL=$(( SKIPPED_TOTAL + 1 ))
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp -a "$src" "$dest"
}

# stage_sqlite <source> <destination> — the SQLite file backing
# DATABASE_URL=sqlite:… (lib/db/url.ts). Absent and unreadable behave exactly
# like stage_file; what is different is *how* a readable one is copied.
#
# A plain `cp` of a live database can catch a write mid-flight and restore as
# silent corruption that opens fine and reads wrong — the database equivalent
# of the torn photograph B114 already guards content/ against, except here
# nothing would even flag it as partial. `sqlite3 "$src" ".backup '$dest'"`
# uses SQLite's own online-backup API — the same one an embedding library like
# better-sqlite3 (`lib/db/client.ts`) would call internally — which takes a
# transactionally consistent snapshot without needing to stop the app.
# `better-sqlite3` itself is a Node module, not a binary this shell script
# could invoke, so `sqlite3` on PATH is the one thing actually checked.
#
# Without it, the fallback is `cp` plus the `-wal`/`-shm` sidecars — WAL mode
# is what `lib/db/client.ts` turns on for every sqlite file, so a fresh write
# often lives in `-wal` rather than in the main file yet. Copying all three
# gives SQLite enough to replay the WAL on open and recover a clean crash, but
# that is CRASH-CONSISTENT, not the transactional guarantee `.backup` gives —
# said here and on stdout, not left to look equivalent.
stage_sqlite() {
  local src="$1" dest="$2"
  if [[ ! -e "$src" ]]; then
    return 0   # not this deployment's dialect (or no DB at all) — nothing to warn about
  fi
  if [[ ! -r "$src" ]]; then
    log "WARNING: sqlite database ($src) could not be staged (not readable) and is NOT in tonight's snapshot"
    SKIPPED_TOTAL=$(( SKIPPED_TOTAL + 1 ))
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  if command -v sqlite3 >/dev/null 2>&1; then
    if sqlite3 "$src" ".backup '$dest'"; then
      log "staged sqlite database ($src) as db/fernscout.db via 'sqlite3 .backup' — transactionally consistent, safe to take while the app keeps writing"
      return 0
    fi
    log "WARNING: 'sqlite3 .backup' failed on $src — falling back to a plain file copy"
  else
    log "WARNING: sqlite3 is not installed on this host — staging $src with a plain file copy instead of SQLite's own online-backup API"
  fi
  log "WARNING: this copy of $src is CRASH-CONSISTENT ONLY, not transactionally clean: a write landing mid-copy can be split between the main file and its -wal sidecar. SQLite replays the WAL on open, which recovers a clean crash, but that is not the guarantee 'sqlite3 .backup' gives. Install sqlite3 on this host to get it."
  cp -a "$src" "$dest"
  local sidecar
  for sidecar in -wal -shm; do
    if [[ -e "${src}${sidecar}" ]]; then
      cp -a "${src}${sidecar}" "${dest}${sidecar}"
    fi
  done
}

# stage_json_stores <data_dir> <destination_dir> — every top-level *.json file
# under DATA_DIR except config.json, which step 3 already claims. This is the
# whole of lib/store.ts's own convention (`readStore`/`updateStore` write
# `<dataDir>/<name>.json` and nowhere else), so the pattern — not two
# hardcoded filenames — is what keeps this an allowlist: a new store the app
# starts writing tomorrow is picked up here without this script changing,
# at the cost of also picking up an unrelated *.json a person drops in
# DATA_DIR by hand. Between "a new store silently missing from every backup"
# and "an unrelated file backed up by mistake", this takes the second.
stage_json_stores() {
  local data_dir="$1" dest_dir="$2"
  [[ -d "$data_dir" ]] || return 0
  shopt -s nullglob
  local f name
  for f in "$data_dir"/*.json; do
    name="${f##*/}"
    if [[ "$name" == "config.json" ]]; then continue; fi
    stage_file "state/$name" "$f" "$dest_dir/$name"
  done
  shopt -u nullglob
}

# --- 1. Database dump, if this deployment has one -------------------------
# The prototype tier (docs/ROADMAP.md §2.2) has no DATABASE_URL and Postgres is
# not even installed — that's not a failure, there is simply nothing to dump.
# The sqlite:… dialect needs no pg_dump either: step 2 below stages the file
# itself, from $DATA_DIR/fernscout.db.
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
  log "no Postgres DATABASE_URL set — skipping pg_dump (sqlite, if any, is staged next)"
fi

# --- 2. The SQLite file, if this deployment uses that dialect --------------
stage_sqlite "$DATA_DIR/fernscout.db" "$STAGING_DIR/db/fernscout.db"

# --- 3. content/ (the canonical, git-tracked trip data) --------------------
# Backed up anyway even though it's in git: an uncommitted edit made straight
# on the VPS (or media that was rsynced but never committed, see ROADMAP A9)
# is exactly the kind of state a "just re-clone the repo" recovery
# would silently lose — and `content/originals` exists nowhere else at all.
#
# Always staged at content/, whatever CONTENT_DIR's actual path is. Older
# runs skipped this stage when CONTENT_DIR was nested inside DATA_DIR, to
# avoid staging the same bytes twice under data/ (B444) — that reason is gone
# now that DATA_DIR is not staged wholesale, so there is nothing left to double
# up against.
if [[ ! -d "$CONTENT_DIR" ]]; then
  log "WARNING: content dir ($CONTENT_DIR) does not exist"
else
  log "staging content/ ($CONTENT_DIR)"
  stage_tree "content/" "$CONTENT_DIR" "$STAGING_DIR/content"
  # Generated per-trip output, stripped back out after staging rather than
  # never staged in the first place: the two directories are nested at
  # content/<user>/postcards and content/<user>/photobooks, inside the tree
  # stage_tree just copied wholesale, not a top-level entry a bigger allowlist
  # could leave out for free. The orders live in the database and the
  # photographs are already in content/, so what is lost here is a PDF that
  # can be produced again.
  find "$STAGING_DIR/content" -mindepth 2 -maxdepth 2 -type d \( -name postcards -o -name photobooks \) -exec rm -rf {} +

  # B662: legacy plaintext mail, stripped back out the same way and for the
  # same structural reason — nested inside content/ rather than top-level, so
  # naming content/ in the allowlist staged it wholesale. lib/mail/index.ts
  # moved sent mail to <dataDir>/mail/ (outside CONTENT_DIR, so never staged
  # here at all) in B636, but a deployment that has not restarted, or that
  # sent mail before B636 shipped, can still have the old directories sitting
  # under content/ — and the sweep in `writeEml` only cleans a shape once
  # something else is written there, so a quiet instance keeps it.
  #
  # Two shapes, both named in lib/mail/index.ts and kept in step with it by
  # hand — a shell script cannot import a TypeScript constant:
  #   - content/.mail/          NO_JOURNAL_DIR in lib/mail/index.ts — signup
  #                             codes for an address that owns no journal yet.
  #   - content/<user>/mail/    legacyMailDir(username) in the same file — one
  #                             journal's own sent mail: real recipient
  #                             addresses, agent codes, sign-in codes.
  # If either name changes there, change the -name arguments below to match.
  find "$STAGING_DIR/content" -mindepth 1 -maxdepth 1 -type d -name '.mail' -exec rm -rf {} +
  find "$STAGING_DIR/content" -mindepth 2 -maxdepth 2 -type d -name mail -exec rm -rf {} +
fi

# --- 4. config/config.json --------------------------------------------------
stage_file "config.json" "$DATA_DIR/config.json" "$STAGING_DIR/config/config.json"

# --- 5. state/*.json (every other top-level JSON file lib/store.ts owns) ----
stage_json_stores "$DATA_DIR" "$STAGING_DIR/state"

# --- 6. env/fernscout.env, minus the key to this backup ---------------------
# Everything needed to rebuild the service travels — DATABASE_URL, SMTP
# credentials, VAPID keys, FERNSCOUT_ADMIN_EMAIL, the object-storage
# credentials for RESTIC_REPOSITORY itself — except RESTIC_PASSWORD. A backup
# that carries the password which decrypts it is no use to somebody holding
# only the backup, and is a wider blast radius if the repository leaks; that
# one secret is the operator's to keep elsewhere (docs/runbook.md).
#
# `grep -v '^RESTIC_PASSWORD='`, not a substring match: the file is one
# KEY=value per line, and anchoring on the whole `KEY=` prefix is what stops
# this from also eating a comment that merely mentions the name, or a
# neighbouring variable whose value happens to contain the string. A
# multi-line value would need more care than this — nothing here writes one.
if [[ ! -e "$ENV_FILE" ]]; then
  log "WARNING: env file ($ENV_FILE) does not exist — a restore from tonight's snapshot would have no environment to start the service with"
elif [[ ! -r "$ENV_FILE" ]]; then
  log "WARNING: env file ($ENV_FILE) could not be staged (not readable) and is NOT in tonight's snapshot"
  SKIPPED_TOTAL=$(( SKIPPED_TOTAL + 1 ))
else
  mkdir -p "$STAGING_DIR/env"
  grep -v '^RESTIC_PASSWORD=' "$ENV_FILE" > "$STAGING_DIR/env/fernscout.env" || true
  log "staged env file ($ENV_FILE) as env/fernscout.env, RESTIC_PASSWORD stripped"
fi

# --- 7. Say what else is under DATA_DIR, and is not in this backup ---------
# The allowlist's own safeguard (W42): the failure mode it trades for is a
# new directory joining DATA_DIR and being silently left out, and this is the
# one place that catches it. One line per entry, every run, until somebody
# either adds the entry above or decides out loud that it never belonged.
#
# Four kinds of entry are claimed elsewhere and must not also be named here:
# config.json (step 4), every other top-level *.json file (step 5 — the whole
# point of stage_json_stores is that this check does not need their names),
# fernscout.db and its -wal/-shm sidecars (step 2), and CONTENT_DIR itself
# when it happens to sit inside DATA_DIR (step 3).
if [[ -d "$DATA_DIR" ]]; then
  shopt -s nullglob dotglob
  for entry in "$DATA_DIR"/*; do
    entry_name="${entry##*/}"
    case "$entry_name" in
      *.json) continue ;;
      fernscout.db|fernscout.db-wal|fernscout.db-shm) continue ;;
    esac
    if [[ -d "$CONTENT_DIR" ]] && is_inside "$CONTENT_DIR" "$entry"; then continue; fi
    if [[ -d "$entry" ]]; then
      log "skipped $entry_name/ (not in the backup set)"
    else
      log "skipped $entry_name (not in the backup set)"
    fi
  done
  shopt -u nullglob dotglob
else
  log "WARNING: DATA_DIR ($DATA_DIR) does not exist — nothing to check it against the backup set"
fi

# --- 8. Push to off-VPS storage with restic --------------------------------
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
# B115 — and bounded, because "a long pause" had no end to it.
#
# restic retries with exponential backoff and no overall deadline: measured
# against a port with nothing listening, `restic cat config` was still going
# after three minutes. The only bound was TimeoutStartSec=30min, and the cost
# is not the wasted half hour — it is that the OnFailure= alert cannot fire
# until the timeout does, so a repository that went unreachable at 03:20 tells
# nobody until 03:50. At the moment the probe is made, "cannot reach it" is
# already available within a couple of seconds of the first refusal.
#
# Wrapping the process rather than asking restic to bound itself: restic has no
# overall deadline option. `--retry-lock` bounds waiting for a *lock*, which is
# a different wait that happens after the repository has been reached, and the
# backend retry settings bound individual requests rather than the call.
#
# `timeout` is coreutils. It is on the VPS and is NOT on macOS without
# `brew install coreutils`, so a missing one falls back to running unwrapped
# and says so, rather than making this script Linux-only — the suite in
# test/backup-script.test.ts runs on a maintainer's laptop, and a backup script
# that cannot be exercised where it is edited is worse than an unbounded probe
# on a machine that has no repository to reach.
probe_timeout="${BACKUP_PROBE_TIMEOUT:-120}"
probe_runner=()
if command -v timeout >/dev/null 2>&1; then
  probe_runner=(timeout "$probe_timeout")
elif command -v gtimeout >/dev/null 2>&1; then
  probe_runner=(gtimeout "$probe_timeout")
else
  log "WARNING: neither timeout nor gtimeout is installed, so the repository probe below is unbounded — on Debian this is coreutils, on macOS 'brew install coreutils'"
fi

log "checking the repository at $RESTIC_REPOSITORY (first call to reach it — a long pause here means it cannot be)"
probe_error=""
probe_status=0
probe_error="$(${probe_runner[@]+"${probe_runner[@]}"} restic cat config 2>&1 >/dev/null)" || probe_status=$?

if (( probe_status == 0 )); then
  repo_state="present"
elif (( probe_status == 10 )); then
  repo_state="absent"
elif (( probe_status == 124 )); then
  # timeout(1) killed it. "Still retrying after $probe_timeout seconds" is the
  # plainest possible evidence of unreachable, and it must never read as absent
  # — `restic init` over a repository that is merely slow is the disaster this
  # whole probe exists to prevent.
  repo_state="unreachable"
  probe_error="no answer within ${probe_timeout}s (BACKUP_PROBE_TIMEOUT), so the probe was stopped"
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

# --- 8b. Does this repository hold what somebody thinks it holds? ----------
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

# --- 8c. Did everything actually get in? -----------------------------------
# Everything that could be saved is now off-site, which is the whole reason
# staging tolerates an unreadable file rather than aborting on one. What must
# not follow is a green light: a snapshot missing paths is not the backup
# anybody thinks they have, and the only place that shows is here.
if (( SKIPPED_TOTAL > 0 )); then
  log "ERROR: the snapshot was pushed, but $SKIPPED_TOTAL path(s) are missing from it — the WARNING lines above name every one."
  log "ERROR: not recording this run as a success: no .backup-last-success stamp, and a non-zero exit so the unit's OnFailure= alert fires and /api/health reports backup.state=failing."
  log "ERROR: content/, config.json, the sqlite database, the JSON stores and the env file must all be readable by the user this unit runs as (usually 'fernscout'). Fix the ownership on the paths above and re-run."
  exit 1
fi

# --- 8d. Off-site copy, if a second destination is configured (B659) -------
#
# The only backup an instance had before this was on the same machine it
# protects — losing the VPS lost every snapshot along with it. This is the
# second, off-box destination, and its whole design rule is B651's: the
# PRIMARY alone decides whether tonight succeeded. Nothing below can turn a
# good primary backup into a failed run, fire the OnFailure= alert, or block
# the `.backup-last-success` stamp step 9 is about to write.
#
# `restic copy --from-repo`, not a second `restic backup`: it reads the
# snapshot the primary already verified, keeps restic's own deduplication, and
# has no way to write back into the primary. The destination repository is
# selected by overriding RESTIC_REPOSITORY for this one command; the source
# password and the destination password are the SAME `RESTIC_PASSWORD` (B655's
# call — one secret to keep, not two), so the source side is supplied as
# `--from-password-command`, which restic execs directly with no shell in
# between (confirmed against 0.19.1: `echo "$RESTIC_PASSWORD"` is passed
# through argv unexpanded and echoes the literal string, not the value) —
# `printenv` needs no shell to read the already-inherited variable.
if [[ -n "${RESTIC_REPOSITORY_SECONDARY:-}" ]]; then
  log "copying tonight's snapshot(s) to the secondary repository at $RESTIC_REPOSITORY_SECONDARY"
  if RESTIC_REPOSITORY="$RESTIC_REPOSITORY_SECONDARY" restic copy \
       --from-repo "$RESTIC_REPOSITORY" \
       --from-password-command 'printenv RESTIC_PASSWORD' \
       --tag fernscout \
       --host "${HOSTNAME:-fernscout-vps}"; then
    log "pruning secondary snapshots older than ${BACKUP_KEEP_DAILY} daily generations"
    if RESTIC_REPOSITORY="$RESTIC_REPOSITORY_SECONDARY" restic forget --tag fernscout --keep-daily "$BACKUP_KEEP_DAILY" --prune; then
      date -u +%FT%TZ > "$DATA_DIR/.backup-last-success-secondary"
      log "recorded secondary success in $DATA_DIR/.backup-last-success-secondary"
    else
      log "WARNING: pruning the secondary repository failed — tonight's copy is still there, and this does not affect the primary or tonight's success"
    fi
  else
    log "WARNING: copying to the secondary repository at $RESTIC_REPOSITORY_SECONDARY failed — the primary backup already succeeded and is unaffected; /api/health will report the secondary as stale until a copy gets through"
  fi
fi

# --- 9. Record that it worked ----------------------------------------------
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
