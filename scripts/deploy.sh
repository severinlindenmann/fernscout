#!/usr/bin/env bash
# Deploy the current branch on the VPS.
#
#   sudo ./scripts/deploy.sh
#
# Build on the machine that serves. There is no image and no artifact to ship:
# a deploy is a pull, an install, a build and a restart. That is the whole
# story, and it is why there is no Docker here.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/fernscout}"
SERVICE="${SERVICE:-fernscout}"
ENV_FILE="${ENV_FILE:-/etc/fernscout/env}"
RUN_AS="${RUN_AS:-fernscout}"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }

# The service's own environment, so this script sees exactly what the running
# process sees. Without it a root shell has no DATABASE_URL, and the migration
# step below would take the "no database configured" branch and say so
# cheerfully — on a deployment that has had one all along.
if [ -f "$ENV_FILE" ]; then
  log "reading $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
else
  log "no $ENV_FILE — continuing with the ambient environment"
fi

# Pull, install and build as the user the service runs as. Doing this as root
# leaves root-owned files in .next/ and node_modules/, and the service — which
# is not root — then fails to write its build cache. `sudo` is how the restart
# is reached, so it is a deliberate step down rather than a step up.
if [ "$(id -u)" -eq 0 ] && [ "$RUN_AS" != "root" ]; then
  as_service() { runuser -u "$RUN_AS" -- "$@"; }
  export HOME
  HOME="$(getent passwd "$RUN_AS" | cut -d: -f6)"
else
  as_service() { "$@"; }
fi

cd "$APP_DIR"

log "pulling"
as_service git pull --ff-only

log "installing dependencies (npm ci — exact lockfile)"
as_service npm ci

# The half of content/ that belongs to the release — locales/ and rates/ —
# into the folder the app actually reads. `git pull` updates $APP_DIR/content,
# and the app reads $CONTENT_DIR, so without this a translation shipped today
# never reaches a reader (B56). It copies those two directories and refuses to
# write anywhere else: config.json and the journals are not a deploy's to touch.
log "syncing shipped content into ${CONTENT_DIR:-$APP_DIR/content}"
as_service "$APP_DIR/scripts/sync-shipped-content.sh"

log "running migrations (no-op when DATABASE_URL is unset)"
if [ -n "${DATABASE_URL:-}" ]; then
  as_service npm run db:migrate
else
  echo "    DATABASE_URL unset — running without a database (supported)"
fi

# Build before restarting, never after: a failed build must leave the running
# site untouched rather than take it down and then fail.
log "building"
as_service npm run build

# The systemd units that ship with this release, into /etc/systemd/system.
# Until B138 the only thing this script wrote there was the drop-in below, and
# a unit was installed by a person running `cp` — so a unit change merged after
# the last manual copy stayed behind while the deploy said "healthy". B64's
# whole notification mechanism sat in git for two days that way.
#
# After the build and before the restart, on purpose: the units describe how to
# run what was just built, and the restart below is what adopts them. A failure
# here therefore aborts with the old site still serving, the same property the
# build-before-restart order exists for.
log "installing systemd units"
"$APP_DIR/scripts/install-units.sh"

# Which commit is actually serving, readable at /api/health. Written to a
# drop-in rather than $ENV_FILE, because that file holds secrets and this is
# the one value that changes on every deploy.
#
# Read through `as_service` like everything else: HOME points at the service
# user by now, so a root `git` here would look for its `safe.directory`
# exception in the wrong config file and refuse the repository it just built.
GIT_SHA="$(as_service git rev-parse HEAD)"
log "recording GIT_SHA=${GIT_SHA:0:12}"
if [ "$(id -u)" -eq 0 ]; then
  mkdir -p "/etc/systemd/system/${SERVICE}.service.d"
  printf '[Service]\nEnvironment=GIT_SHA=%s\n' "$GIT_SHA" \
    > "/etc/systemd/system/${SERVICE}.service.d/git-sha.conf"
  systemctl daemon-reload
fi

log "restarting ${SERVICE}"
sudo systemctl restart "$SERVICE"
if systemctl is-enabled --quiet fernscout-worker 2>/dev/null; then
  sudo systemctl restart fernscout-worker
fi

# Whether the backup is working, printed by the one command this deployment's
# operator definitely runs. Never fatal — a stale backup is not a reason to
# refuse a deploy — but it is said out loud, every time, because the failure
# mode B64 records is precisely one nobody went looking for.
report_backup() {
  local health="$1"
  local state
  state="$(printf '%s' "$health" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const b=JSON.parse(s).backup;process.stdout.write(b?`${b.state}\t${b.reason??b.lastSuccessAt??""}`:"")}catch{}})' \
    2>/dev/null)" || state=""
  case "${state%%$'\t'*}" in
    ok) log "backup: ok (last success ${state#*$'\t'})" ;;
    "") ;;  # an older build with no .backup block, or node unavailable
    *) echo "WARNING: backup ${state%%$'\t'*} — ${state#*$'\t'}" >&2 ;;
  esac
}

# Whether the proxy in front of this app is still the one the release expects
# (B66). `deploy/fernscout.caddy` is imported by the machine's Caddyfile, so on
# a machine that took the import there is nothing to say; on one whose operator
# merged the block by hand — the normal case on a shared host — a proxy
# directive added in this release has *not* arrived, and this is where that
# gets said instead of being discovered a year later by somebody debugging a
# rate limit. Never fatal: nothing about the proxy is this script's to change,
# and refusing to finish a deploy over it would be worse than the drift.
report_caddy() {
  local out status
  set +e
  out="$(as_service npm run --silent check:caddy 2>&1)"
  status=$?
  set -e
  case "$status" in
    0) log "caddy: the running config carries what this release expects" ;;
    1) printf '%s\n' "$out" >&2 ;;
    # Exit 2 is "could not ask" — no caddy on PATH, no config file, an adapter
    # error. Said quietly and in one line, because a machine that does not use
    # Caddy at all is a supported deployment and must not be nagged.
    *) log "caddy: not checked (${out%%$'\n'*})" ;;
  esac
}

log "waiting for health"
for i in $(seq 1 30); do
  if HEALTH="$(curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" 2>/dev/null)"; then
    log "healthy"
    report_backup "$HEALTH"
    report_caddy
    exit 0
  fi
  sleep 1
done

echo "ERROR: did not become healthy in 30s. journalctl -u ${SERVICE} -n 50" >&2
exit 1
