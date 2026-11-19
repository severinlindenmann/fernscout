#!/usr/bin/env bash
# Run a Fernscout job in a one-off container of the running app's image, on
# the same network, mounts and env as the app (compose.yaml).
#   job.sh backup                 scripts/backup.sh
#   job.sh alert <unit>           scripts/alert.sh <unit>
#   job.sh <npm script> [args]    npm run <script> -- [args]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
engine="${CONTAINER_ENGINE:-kiri}"
compose=("$engine" compose -f "$here/compose.yaml")
[ -n "${FERNSCOUT_COMPOSE_ENV:-}" ] && compose+=(--env-file "$FERNSCOUT_COMPOSE_ENV")
job="${1:?which job}"; shift || true
case "$job" in
  backup) cmd=(/app/scripts/backup.sh) ;;
  alert)  cmd=(/app/scripts/alert.sh "$@") ;;
  *)      cmd=(npm run --silent "$job" -- "$@") ;;
esac
exec "${compose[@]}" run --rm --no-deps -T app "${cmd[@]}"
