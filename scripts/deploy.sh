#!/usr/bin/env bash
# Deploy the current branch on the VPS.
#
#   sudo ./scripts/deploy.sh                 # do what the diff needs
#   sudo ./scripts/deploy.sh --full          # do everything, trust nothing
#        ./scripts/deploy.sh --plan <paths…> # what those paths would cost
#
# Build on the machine that serves. There is no image and no artifact to ship:
# a deploy is a pull, an install, a build and a restart. That is the whole
# story, and it is why there is no Docker here.
#
# What it is *not* is the same eight steps whatever arrived. B258: `npm ci`
# rewrote node_modules against a lockfile it already had, `db:migrate` started
# a tsx process to find nothing to do, and `install-units.sh` rewrote units
# nobody had touched — on a deploy whose entire content was a task file. The
# steps below are therefore chosen from `git diff`, and the marker that makes
# that safe is $STATE_FILE: the last commit this script brought up *healthy*.
# A build that fails leaves it alone, so the next attempt re-plans from the
# commit it managed to serve rather than from the one it never did.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/fernscout}"
SERVICE="${SERVICE:-fernscout}"
ENV_FILE="${ENV_FILE:-/etc/fernscout/env}"
RUN_AS="${RUN_AS:-fernscout}"
STATE_FILE="${STATE_FILE:-$APP_DIR/.deploy-state}"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
skip() { printf '    \033[2m%-9s skipped — %s\033[0m\n' "$1" "$2"; }

# ---------------------------------------------------------------------------
# What a set of changed paths costs.
#
# Every step is off until a path asks for it, and the last case asks for a
# build: an unrecognised path — a new top-level directory, a config file
# nobody has thought about yet — is far likelier to be code than
# documentation, and being wrong that way costs 40 seconds rather than a
# stale site.
# ---------------------------------------------------------------------------
do_install=0 do_migrate=0 do_sync=0 do_build=0 do_units=0 do_caddy=0 do_restart=0
notes=()

note() {
  local line
  for line in "${notes[@]+"${notes[@]}"}"; do [ "$line" = "$1" ] && return 0; done
  notes+=("$1")
}

classify() {
  local path
  for path in "$@"; do
    case "$path" in
      # Dependencies. The slowest step there is, and the one that ran every
      # time for nothing.
      package.json | package-lock.json)
        do_install=1 do_build=1 do_restart=1 ;;

      # The database's shape. `db:migrate` is idempotent, so this is about the
      # tsx startup rather than about safety.
      lib/db/migrations/* | lib/db/migrate.ts | lib/db/schema.ts)
        do_migrate=1 do_build=1 do_restart=1 ;;

      # The half of content/ that belongs to the release. It has to be copied
      # into $CONTENT_DIR to reach a reader at all (B56), and it is baked into
      # prerendered pages, so it builds too.
      content/locales/* | content/rates/*)
        do_sync=1 do_build=1 do_restart=1 ;;

      # The other half belongs to the operator, and a deploy deliberately does
      # not copy it — including content/example, which is seeded by hand. Said
      # out loud rather than silently skipped, because "I edited the example
      # journal and deployed" is a reasonable thing to have expected to work.
      content/*)
        note "content/ outside locales/ and rates/ changed — a deploy does not copy it into \$CONTENT_DIR" ;;

      # systemd units, and the proxy config that is only ever reported on.
      deploy/*.service | deploy/*.timer | deploy/*.socket | deploy/*.target)
        do_units=1 do_restart=1 ;;
      deploy/*.caddy | deploy/Caddyfile)
        do_caddy=1 ;;

      # Nothing here reaches the running site. Prose, tests, CI, agent skills,
      # and the scripts an operator runs by hand — all of which arrive with
      # the `git pull` above and need nothing done to them.
      docs/* | test/* | scripts/* | .claude/* | .github/* | *.md | LICENSE | \
      .gitignore | .npmrc | .env.example | knip.jsonc | vitest.config.* | eslint.config.*)
        : ;;

      # app/, lib/, components/, public/, next.config.ts, tsconfig.json,
      # middleware.ts — and anything new.
      *)
        do_build=1 do_restart=1 ;;
    esac
  done
}

full_plan() { do_install=1 do_migrate=1 do_sync=1 do_build=1 do_units=1 do_caddy=1 do_restart=1; }

# The plan, in the order it will run, one line per step. Printed before
# anything happens: a deploy that is about to skip the build should say so
# while there is still time to disagree with it.
print_plan() {
  local yes=0
  [ "$do_install" = 1 ] && { log "will install dependencies"; yes=1; }
  [ "$do_migrate" = 1 ] && { log "will run migrations"; yes=1; }
  [ "$do_sync" = 1 ] && { log "will sync shipped content"; yes=1; }
  [ "$do_build" = 1 ] && { log "will build"; yes=1; }
  [ "$do_units" = 1 ] && { log "will install systemd units"; yes=1; }
  [ "$do_restart" = 1 ] && { log "will restart ${SERVICE}"; yes=1; }
  [ "$do_caddy" = 1 ] && { log "will check the Caddy config"; yes=1; }
  [ "$yes" = 0 ] && log "nothing to do — nothing that reaches the running site changed"
  local line
  for line in "${notes[@]+"${notes[@]}"}"; do printf '    note: %s\n' "$line"; done
  return 0
}

case "${1:-}" in
  --plan)
    shift
    [ $# -gt 0 ] || { echo "usage: deploy.sh --plan <path> [<path>…]" >&2; exit 2; }
    classify "$@"
    print_plan
    exit 0
    ;;
  --full) MODE=full ;;
  "") MODE=auto ;;
  -h | --help)
    sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "deploy.sh: unknown argument '$1' (--full, --plan, --help)" >&2
    exit 2
    ;;
esac

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

# What was last brought up healthy, if anything says so.
DEPLOYED=""
if [ -f "$STATE_FILE" ]; then
  DEPLOYED="$(tr -dc '0-9a-f' < "$STATE_FILE" | head -c 40)"
  if [ -z "$DEPLOYED" ] || ! as_service git cat-file -e "${DEPLOYED}^{commit}" 2>/dev/null; then
    log "$STATE_FILE names no commit this repository has — deploying in full"
    DEPLOYED=""
  fi
fi

log "pulling"
as_service git pull --ff-only
HEAD_SHA="$(as_service git rev-parse HEAD)"

if [ "$MODE" = full ]; then
  log "--full: every step, whatever changed"
  full_plan
elif [ -z "$DEPLOYED" ]; then
  log "no record of a previous deploy — doing everything once"
  full_plan
elif [ "$DEPLOYED" = "$HEAD_SHA" ]; then
  log "already at ${HEAD_SHA:0:12}, and it was healthy"
  # Except when it is not running, which is the one reason to have typed this
  # command with nothing to pull.
  if ! systemctl is-active --quiet "$SERVICE"; then
    log "${SERVICE} is not active — restarting it"
    do_restart=1
  fi
else
  CHANGED="$(as_service git diff --name-only "$DEPLOYED" "$HEAD_SHA")"
  COUNT="$(printf '%s' "$CHANGED" | grep -c . || true)"
  log "${COUNT} file(s) changed since ${DEPLOYED:0:12}"
  # shellcheck disable=SC2086
  [ -n "$CHANGED" ] && classify $CHANGED
fi

print_plan

if [ "$do_install" = 1 ]; then
  log "installing dependencies (npm ci — exact lockfile)"
  as_service npm ci
else
  skip "install" "package-lock.json unchanged"
fi

# The half of content/ that belongs to the release — locales/ and rates/ —
# into the folder the app actually reads. `git pull` updates $APP_DIR/content,
# and the app reads $CONTENT_DIR, so without this a translation shipped today
# never reaches a reader (B56). It copies those two directories and refuses to
# write anywhere else: config.json and the journals are not a deploy's to touch.
if [ "$do_sync" = 1 ]; then
  log "syncing shipped content into ${CONTENT_DIR:-$APP_DIR/content}"
  as_service "$APP_DIR/scripts/sync-shipped-content.sh"
else
  skip "sync" "no shipped locales or rates changed"
fi

if [ "$do_migrate" = 1 ]; then
  log "running migrations (no-op when DATABASE_URL is unset)"
  if [ -n "${DATABASE_URL:-}" ]; then
    as_service npm run db:migrate
  else
    echo "    DATABASE_URL unset — running without a database (supported)"
  fi
else
  skip "migrate" "no migration or schema change"
fi

# Build before restarting, never after: a failed build must leave the running
# site untouched rather than take it down and then fail.
if [ "$do_build" = 1 ]; then
  log "building"
  as_service npm run build
else
  skip "build" "nothing the build reads changed"
fi

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
if [ "$do_units" = 1 ]; then
  log "installing systemd units"
  "$APP_DIR/scripts/install-units.sh"
else
  skip "units" "deploy/ unit files unchanged"
fi

# Which commit is actually serving, readable at /api/health. Written to a
# drop-in rather than $ENV_FILE, because that file holds secrets and this is
# the one value that changes on every deploy.
#
# Only when there is a restart to adopt it. Written without one, it would
# relabel the *running* build with a commit it was not built from at the next
# reboot — and a version label that lies is worse than one that lags.
#
# Read through `as_service` like everything else: HOME points at the service
# user by now, so a root `git` here would look for its `safe.directory`
# exception in the wrong config file and refuse the repository it just built.
if [ "$do_restart" = 1 ]; then
  log "recording GIT_SHA=${HEAD_SHA:0:12}"
  if [ "$(id -u)" -eq 0 ]; then
    mkdir -p "/etc/systemd/system/${SERVICE}.service.d"
    printf '[Service]\nEnvironment=GIT_SHA=%s\n' "$HEAD_SHA" \
      > "/etc/systemd/system/${SERVICE}.service.d/git-sha.conf"
    systemctl daemon-reload
  fi

  log "restarting ${SERVICE}"
  sudo systemctl restart "$SERVICE"
  if systemctl is-enabled --quiet fernscout-worker 2>/dev/null; then
    sudo systemctl restart fernscout-worker
  fi
else
  skip "restart" "the running build is still the right one"
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

# Whether this deploy is writing a request log, printed for the same reason
# as backup state: an operator who turned `features.logging` on has no other
# way to learn from a deploy that it actually took, and one who never did
# should be told there is nothing to check yet rather than left to guess
# (B257). Never fatal — this is an operator's own choice, not a health check.
report_logging() {
  local health="$1"
  local enabled
  enabled="$(printf '%s' "$health" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).capabilities?.logging?.enabled))}catch{}})' \
    2>/dev/null)" || enabled=""
  case "$enabled" in
    true) log "logging: on — requests are in journalctl -u ${SERVICE}" ;;
    false) log "logging: off (features.logging.enabled in content/config.json)" ;;
    *) ;;  # an older build with no logging capability at all
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

# The marker, written here rather than anywhere earlier: everything above is a
# step that can fail, and a commit recorded before health went green is a
# commit the next deploy would decline to build.
record_deployed() {
  printf '%s\n' "$HEAD_SHA" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  chown "$RUN_AS" "$STATE_FILE" 2>/dev/null || true
}

log "waiting for health"
for i in $(seq 1 30); do
  if HEALTH="$(curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" 2>/dev/null)"; then
    log "healthy"
    record_deployed
    report_backup "$HEALTH"
    report_logging "$HEALTH"
    [ "$do_caddy" = 1 ] && report_caddy
    if [ "$do_restart" = 0 ] && [ "$do_build" = 0 ]; then
      log "note: /api/health still reports the commit it was built from — that is what is serving"
    fi
    exit 0
  fi
  sleep 1
done

echo "ERROR: did not become healthy in 30s. journalctl -u ${SERVICE} -n 50" >&2
exit 1
