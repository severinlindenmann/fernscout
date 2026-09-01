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

log "waiting for health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" > /dev/null 2>&1; then
    log "healthy"
    exit 0
  fi
  sleep 1
done

echo "ERROR: did not become healthy in 30s. journalctl -u ${SERVICE} -n 50" >&2
exit 1
