#!/usr/bin/env bash
#
# Install the systemd units that ship with the release, so a unit change
# reaches the machine the same way a code change does.
#
#   scripts/install-units.sh
#   SYSTEMD_DIR=/tmp/units scripts/install-units.sh    # what a test does
#
# B138: `scripts/deploy.sh` pulled, built and restarted, and its only write
# under /etc/systemd/system was the GIT_SHA drop-in. Installing a unit was a
# manual `sudo cp` documented in a comment in the unit's own header — so any
# unit change merged after the last manual copy stayed behind, silently, while
# the deploy reported success. That is how B64's OnFailure= handler sat in git
# for two days: the application half of that task shipped and the systemd half,
# which was the entire notification mechanism, never arrived.
#
# The rule this script encodes: **the release owns the unit definitions; the
# operator owns what runs.**
#
# It therefore copies and reloads, and deliberately does not enable, disable or
# start anything. `deploy/fernscout-worker.service` is why — its own header
# says to enable it "when there is something for it to do", and a deploy that
# enabled every newly added unit would start a worker against an empty queue.
# Units that are installed but not enabled are named at the end instead, which
# is the note an operator can act on and a script cannot.
#
# B203: it now also asks systemd whether it *understood* what was installed.
# `OnFailure=` sat in `[Service]` in the backup unit for weeks — a `[Unit]`
# directive, so systemd logged "Unknown key 'OnFailure' in section [Service],
# ignoring" and loaded a backup that could not report its own failure. The file
# was right by every check anybody had, because every check asked whether the
# line was present rather than whether systemd had read it.
#
# Env:
#   UNIT_SRC          where the units ship from. Default: <repo>/deploy
#   SYSTEMD_DIR       where they are installed. Default: /etc/systemd/system
#   SYSTEMCTL         the systemctl to drive. Default: systemctl
#   SYSTEMD_ANALYZE   the verifier. Default: systemd-analyze
#
# Exit 1 when a unit differs and cannot be written. That is the point of the
# task: a deploy that could not install a changed unit must not report success.
# Exit 1, too, when systemd rejected a key in a unit this run installed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
UNIT_SRC="${UNIT_SRC:-$APP_DIR/deploy}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
SYSTEMD_ANALYZE="${SYSTEMD_ANALYZE:-systemd-analyze}"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -d "$UNIT_SRC" ] || fail "no unit source at $UNIT_SRC — is APP_DIR the repository?"

# Only units. deploy/Caddyfile and deploy/fernscout.caddy live in the same
# folder and are not systemd's and not this script's: Caddy has one shared
# config file on the host, so copying it over is a different and more dangerous
# act. Since B66 the proxy keeps up by being imported out of the checkout
# rather than copied anywhere, and scripts/check-caddy.mts reports it when it
# has not.
shopt -s nullglob
UNITS=("$UNIT_SRC"/*.service "$UNIT_SRC"/*.timer)
shopt -u nullglob
if [ "${#UNITS[@]}" -eq 0 ]; then fail "no .service or .timer files in $UNIT_SRC"; fi

changed=()
for src in "${UNITS[@]}"; do
  name="$(basename "$src")"
  dest="$SYSTEMD_DIR/$name"
  # cmp rather than a checksum: the answer is "identical or not", and a unit
  # file is small enough that reading it twice costs nothing.
  if [ ! -e "$dest" ] || ! cmp -s "$src" "$dest"; then
    changed+=("$name")
  fi
done

if [ "${#changed[@]}" -eq 0 ]; then
  log "systemd units are current (${#UNITS[@]} checked)"
  exit 0
fi

# Named before anything is attempted, so the list is in the log whether the
# install then succeeds or fails. Being able to see *which* file drifted is
# most of what B138 was missing.
log "systemd units differing from ${UNIT_SRC#"$APP_DIR"/}: ${changed[*]}"

if [ ! -d "$SYSTEMD_DIR" ] || [ ! -w "$SYSTEMD_DIR" ]; then
  {
    printf 'ERROR: cannot write %s, so these units stay stale:\n' "$SYSTEMD_DIR"
    for name in "${changed[@]}"; do printf '  %s\n' "$name"; done
    printf '\nRun the deploy as root, or copy them by hand:\n'
    printf '  sudo cp'
    for name in "${changed[@]}"; do printf ' %s/%s' "${UNIT_SRC#"$APP_DIR"/}" "$name"; done
    printf ' %s/\n  sudo systemctl daemon-reload\n' "$SYSTEMD_DIR"
  } >&2
  exit 1
fi

for name in "${changed[@]}"; do
  # `install` rather than `cp`: mode and ownership are stated rather than
  # inherited from whatever the repository checkout happens to carry.
  install -m 0644 "$UNIT_SRC/$name" "$SYSTEMD_DIR/$name"
  log "installed $name"
done

"$SYSTEMCTL" daemon-reload
log "daemon-reload"

# --- Did systemd understand the files? (B203) ------------------------------
#
# A directive in the wrong section is the quietest defect systemd has. The unit
# parses, it loads, `systemctl status` is green, and the directive is simply
# not there — the only trace is one line in the journal at reload time.
#
# `daemon-reload`'s own output is not that trace and never was: the parse
# warnings come from PID 1 and go to the journal, so the process this script
# runs and reads exits silently whatever it just refused to understand. Asking
# `systemd-analyze verify` is what actually surfaces them, and it reads the
# installed copies rather than the repository's, so it also catches a unit
# somebody edited in /etc/systemd/system by hand.
#
# Only the unknown-key class is fatal. The rest of what `verify` says about
# these units is expected on a machine that is not yet fully set up — a user
# that has not been created, a WorkingDirectory that does not exist yet — and
# failing a deploy on those would mean failing every first deploy.
if command -v "$SYSTEMD_ANALYZE" >/dev/null 2>&1; then
  verify_paths=()
  for name in "${changed[@]}"; do verify_paths+=("$SYSTEMD_DIR/$name"); done
  # verify exits non-zero for the tolerated diagnostics too, so its status is
  # deliberately discarded and only its words are read.
  verify_out="$("$SYSTEMD_ANALYZE" verify "${verify_paths[@]}" 2>&1 || true)"
  rejected="$(printf '%s\n' "$verify_out" | grep -Ei 'Unknown key|Unknown lvalue|Unknown section' || true)"
  if [ -n "$rejected" ]; then
    {
      printf 'ERROR: systemd rejected a key in a unit this deploy just installed:\n'
      printf '%s\n' "$rejected" | sed 's/^/  /'
      printf '\nA directive systemd does not read is a directive that does nothing, and\n'
      printf 'nothing downstream can notice — the unit still loads and still looks fine.\n'
      printf 'Fix the section it sits in (man systemd.directives) and deploy again.\n'
    } >&2
    exit 1
  fi
  log "systemd-analyze verify: no unknown keys"
else
  log "note: no $SYSTEMD_ANALYZE on PATH — a misplaced directive would be installed unnoticed (B203)"
fi

for name in "${changed[@]}"; do
  case "$name" in
    *.timer)
      # A reload re-reads the definition but does not re-arm a timer that is
      # already running with the old schedule, so a changed OnCalendar= would
      # otherwise not take effect until the next boot. Only if it is already
      # running: starting a timer nobody enabled is the operator's call.
      if "$SYSTEMCTL" is-active --quiet "$name" 2>/dev/null; then
        "$SYSTEMCTL" restart "$name"
        log "re-armed $name"
      fi
      ;;
  esac
done

# Services are deliberately not restarted here. fernscout.service and
# fernscout-worker.service are restarted by deploy.sh a few lines later;
# fernscout-backup.service is a oneshot the timer drives, and
# fernscout-alert@.service is a template started by OnFailure= — for both of
# those, the reload above is the whole of what "take effect" means.

for name in "${changed[@]}"; do
  # A template unit takes an instance and can never be enabled by bare name.
  case "$name" in *@.service) continue ;; esac
  grep -q '^\[Install\]' "$UNIT_SRC/$name" || continue
  if ! "$SYSTEMCTL" is-enabled --quiet "$name" 2>/dev/null; then
    log "note: $name is installed but not enabled — 'systemctl enable --now $name' if it should run"
  fi
done
