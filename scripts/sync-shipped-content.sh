#!/usr/bin/env bash
#
# Copy the half of content/ that ships with the code into the content folder
# the running app reads.
#
#   CONTENT_DIR=/var/lib/fernscout/content scripts/sync-shipped-content.sh
#   npm run content:sync
#
# `content/` holds two things with two lifecycles, and only one of them is a
# deploy's business:
#
#   shipped with the code   locales/, rates/,   belongs to the release
#                           legal/
#   owned by the operator   config.json,       must survive every deploy
#                           <username>/        untouched
#
# A deploy is a `git pull` into $APP_DIR, so the shipped half updates in the
# repository and not in $CONTENT_DIR — which is where the app reads its
# journals, its rates, and (on top of the shipped dictionaries) its UI strings.
# That is B56: the live site served August's German for a month because nothing
# ever repeated the one-time seeding copy.
#
# Two properties this script exists to have:
#
#   1. It **replaces** each shipped directory rather than merging into it, so a
#      string deleted from the repository actually disappears. `me.newHere` was
#      still being served precisely because a merge would have kept it.
#   2. It writes **nowhere else**. The names it may touch are a fixed list that
#      `test/sync-shipped-content.test.ts` holds against `INSTANCE_DIRS` in
#      lib/users.ts, every destination is checked to be exactly one directory
#      under $CONTENT_DIR, and anything else is a hard failure rather than a
#      comment asking nicely. A blanket `cp -a` here would overwrite somebody's
#      journal, which is a worse bug than the one being fixed.
#
# An instance that deliberately overrides a shipped directory — the supported
# way to reword the UI, see docs/runbook.md — marks it by putting a file
# called `.keep-local` inside it. This script then leaves it alone and says so.
#
# Env:
#   CONTENT_DIR   what the app reads. Default: <repo>/content, in which case
#                 there is nothing to copy and this is a no-op.
#   APP_DIR       the repository. Default: the parent of this script's folder.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SRC_DIR="$APP_DIR/content"
DEST_DIR="${CONTENT_DIR:-$APP_DIR/content}"

# The directories that ship with the software. Kept in step with
# `INSTANCE_DIRS` in lib/users.ts by a test — those are the same names for the
# same reason: they are not people. `legal/` is the instance's imprint, which
# an instance with its own overrides by putting `.keep-local` in it.
SHIPPED=(locales rates legal)

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -d "$SRC_DIR" ] || fail "no content/ in $APP_DIR — is APP_DIR the repository?"
[ -d "$DEST_DIR" ] || fail "CONTENT_DIR=$DEST_DIR does not exist (create and seed it first — docs/runbook.md)"

SRC_REAL="$(cd "$SRC_DIR" && pwd -P)"
DEST_REAL="$(cd "$DEST_DIR" && pwd -P)"

if [ "$SRC_REAL" = "$DEST_REAL" ]; then
  log "CONTENT_DIR is the repository's own content/ — nothing to copy"
  exit 0
fi

cleanup() {
  for name in "${SHIPPED[@]}"; do
    rm -rf "${DEST_REAL:?}/.incoming-$name" "${DEST_REAL:?}/.outgoing-$name"
  done
}
trap cleanup EXIT

for name in "${SHIPPED[@]}"; do
  # Belt and braces before anything is deleted: the name is a plain directory
  # name, and the path it lands on is exactly one level under CONTENT_DIR.
  # Neither can currently be false; both would be catastrophic if they were.
  case "$name" in
    *[!a-z]* | "") fail "refusing to sync '$name': not a plain lowercase directory name" ;;
  esac
  target="$DEST_REAL/$name"
  [ "$(dirname "$target")" = "$DEST_REAL" ] || fail "refusing to sync '$name': $target is not directly under $DEST_REAL"

  if [ ! -d "$SRC_DIR/$name" ]; then
    log "$name: not in the repository — skipped"
    continue
  fi

  if [ -e "$target/.keep-local" ]; then
    log "$name: .keep-local present — this instance overrides it, leaving it alone"
    continue
  fi

  # Staged and swapped rather than copied in place: a half-written dictionary
  # is a site with half its words, and the app reads these files on demand.
  staging="$DEST_REAL/.incoming-$name"
  rm -rf "$staging"
  mkdir -p "$staging"
  cp -a "$SRC_DIR/$name/." "$staging/"
  if [ -d "$target" ]; then
    rm -rf "$DEST_REAL/.outgoing-$name"
    mv "$target" "$DEST_REAL/.outgoing-$name"
  fi
  mv "$staging" "$target"
  rm -rf "$DEST_REAL/.outgoing-$name"

  count="$(find "$target" -type f | wc -l | tr -d ' ')"
  log "$name: replaced from the repository ($count files)"
done

# Say it out loud rather than trusting the copy: this is the assertion the
# runbook points at, and it is cheap.
for name in "${SHIPPED[@]}"; do
  if [ -d "$SRC_DIR/$name" ] && [ ! -e "$DEST_REAL/$name/.keep-local" ]; then
    diff -r "$SRC_DIR/$name" "$DEST_REAL/$name" > /dev/null \
      || fail "$name in $DEST_REAL still differs from the repository after syncing"
  fi
done

log "shipped content is identical to the repository"
