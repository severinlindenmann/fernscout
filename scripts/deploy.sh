#!/usr/bin/env bash
# Deploy the current branch on the VPS.
#
#   ./scripts/deploy.sh
#
# Build on the machine that serves. There is no image and no artifact to ship:
# a deploy is a pull, an install, a build and a restart. That is the whole
# story, and it is why there is no Docker here.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/fernscout}"
SERVICE="${SERVICE:-fernscout}"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }

cd "$APP_DIR"

log "pulling"
git pull --ff-only

log "installing dependencies (npm ci — exact lockfile)"
npm ci

log "running migrations (no-op when DATABASE_URL is unset)"
if [ -n "${DATABASE_URL:-}" ]; then
  npm run db:migrate
else
  echo "    DATABASE_URL unset — running without a database (supported)"
fi

# Build before restarting, never after: a failed build must leave the running
# site untouched rather than take it down and then fail.
log "building"
npm run build

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
