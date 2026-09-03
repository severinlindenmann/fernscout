#!/usr/bin/env bash
#
# Something failed. Say so, to a person and to /api/health.
#
#   scripts/alert.sh fernscout-backup.service
#
# Wired up as `OnFailure=fernscout-alert@%n.service` on the unit that matters
# (deploy/fernscout-backup.service), so systemd runs it the moment that unit
# enters `failed`. Nothing polls; nothing has to be asked.
#
# Why this exists: `scripts/backup.sh` failed three nights running on the live
# server and the only reason anybody found out is that a person happened to be
# tailing `journalctl` at the time. Nothing mailed, nothing degraded,
# /api/health knew nothing (B64).
#
# Two independent channels, because either one can be unavailable on its own:
#
#   1. A stamp file, `$DATA_DIR/.backup-last-failure`. Pure shell, no node, no
#      network, no configuration — it works on an instance with mail switched
#      off, which is every instance by default. /api/health reports it.
#   2. Mail to the operator, via the app's own transport (`npm run alert`).
#      Off-box, and the only one that reaches somebody who is not looking.
#
# Deliberately not `set -e`: an alarm that gives up halfway is the failure this
# script exists to prevent. Every step is attempted, whatever the last one did.
#
# Env (systemd supplies it from /etc/fernscout/env):
#   DATA_DIR             where the stamp is written; without it, only mail runs
#   BACKUP_ALERT_EMAIL   who to tell — defaults to the default journal's owner
#   APP_DIR              default: this script's directory, minus /scripts

set -uo pipefail

UNIT="${1:-unknown.service}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
NOW="$(date -u +%FT%TZ)"

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

log "$UNIT failed — raising the alarm"

# --- What happened, as far as this box can tell ----------------------------
# All optional. `systemctl` is absent on a developer laptop, and `journalctl`
# refuses a user who is not in the systemd-journal group; neither is a reason
# to send nothing.
RESULT="$(systemctl show "$UNIT" --property=Result --value 2>/dev/null)" || RESULT=""
EXIT_STATUS="$(systemctl show "$UNIT" --property=ExecMainStatus --value 2>/dev/null)" || EXIT_STATUS=""
JOURNAL="$(journalctl -u "$UNIT" -n 25 --no-pager 2>/dev/null)" || JOURNAL=""

SUMMARY="$UNIT failed"
[[ -n "$RESULT" ]] && SUMMARY="$SUMMARY (result=$RESULT)"
[[ -n "$EXIT_STATUS" && "$EXIT_STATUS" != "0" ]] && SUMMARY="$SUMMARY (exit $EXIT_STATUS)"
log "$SUMMARY"

STAMPED=0
MAILED=0

# --- 1. The stamp ----------------------------------------------------------
# Only for the backup unit: the file is named for backups, /api/health reads it
# as a backup fact, and a worker failure recorded there would be a lie.
if [[ "$UNIT" == fernscout-backup* && -n "${DATA_DIR:-}" ]]; then
  if [[ -d "$DATA_DIR" ]]; then
    # First line ISO-8601, the rest free text — lib/backupStatus.ts reads it
    # that way, and `cat` on the box reads it the same way.
    {
      printf '%s\n' "$NOW"
      printf '%s\n' "$SUMMARY"
    } > "$DATA_DIR/.backup-last-failure" && STAMPED=1
  fi
  if (( STAMPED )); then
    log "recorded the failure in $DATA_DIR/.backup-last-failure — /api/health will report it"
  else
    log "WARNING: could not write the failure stamp under DATA_DIR (${DATA_DIR:-unset})"
  fi
fi

# --- 2. The mail -----------------------------------------------------------
# `npm run alert` needs node_modules and a configured mail transport; a box
# that has neither still has the stamp above.
BODY="$SUMMARY

$( [[ -n "$JOURNAL" ]] && printf '%s' "$JOURNAL" || printf 'No journal was readable from this unit; run: journalctl -u %s -n 50' "$UNIT" )"

if printf '%s\n' "$BODY" | (cd "$APP_DIR" && npm run --silent alert -- --unit "$UNIT"); then
  MAILED=1
else
  log "WARNING: could not mail the alert (see above). The failure is still recorded on this box."
fi

if (( STAMPED == 0 && MAILED == 0 )); then
  log "ERROR: neither channel worked — nothing outside this journal knows $UNIT failed"
  exit 1
fi

log "done"
