#!/usr/bin/env bash
#
# Reach the restic repository by hand — `snapshots`, `unlock`, `check`, an
# ad-hoc `init` — without putting RESTIC_PASSWORD on any command line.
#
#   sudo ./scripts/restic.sh snapshots
#   sudo ./scripts/restic.sh unlock
#
# `sudo RESTIC_PASSWORD=… -u fernscout restic …` looks like the obvious way to
# type this, and it is the wrong one: sudo logs every VAR=value assignment
# given on ITS OWN command line verbatim, in plaintext, to the journal —
#
#   sudo[…]: root : PWD=/root ; USER=fernscout ;
#     ENV=RESTIC_PASSWORD=<the real value> ; COMMAND=/usr/bin/restic …
#
# — a journal that is retained, rotated and swept up by any log collection
# (B1707). Passing it as an argument to `env` instead (`sudo -u fernscout env
# RESTIC_PASSWORD=… restic …`) is no better: sudo's COMMAND= field logs that
# whole line too, and `ps` shows it to anyone on the box in the meantime.
#
# This script reads RESTIC_PASSWORD (and RESTIC_REPOSITORY, and the off-site
# AWS_* keys) from the env file instead, exactly the way the systemd unit
# does, then hands them to restic through the environment `-E` carries across
# sudo — never through argv, so they never become a logged or listable
# command-line argument.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: sudo ./scripts/restic.sh <restic args…>   e.g. snapshots, unlock, check" >&2
  exit 1
fi

ENV_FILE="${ENV_FILE:-/etc/fernscout/env}"
if [ ! -r "$ENV_FILE" ]; then
  echo "cannot read $ENV_FILE — run this with sudo (or as a user that can read it)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set in $ENV_FILE}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD must be set in $ENV_FILE}"

exec sudo -u fernscout -E restic "$@"
