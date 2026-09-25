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
# steps below are therefore chosen from `git diff`, and the baseline that
# diff is taken from is what /api/health says is actually running — asked of
# the service live — not a local state file, since a state file advances
# whether or not the build it describes really happened (B559). A build that
# fails, or a restart that does not take, leaves the live answer alone, so
# the next attempt re-plans from the commit actually served rather than from
# one this script only hoped was.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/fernscout}"
SERVICE="${SERVICE:-fernscout}"
ENV_FILE="${ENV_FILE:-/etc/fernscout/env}"
RUN_AS="${RUN_AS:-fernscout}"
STATE_FILE="${STATE_FILE:-$APP_DIR/.deploy-state}"
# B2230: where a build goes before it is swapped in. See "building" below.
BUILD_DIR=.next-build

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
do_install=0 do_migrate=0 do_build=0 do_units=0 do_caddy=0 do_restart=0
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

      # The instance itself: dictionaries, rates, the imprint, the server
      # config. It arrives with the `git pull` above and the app reads it from
      # the checkout, so nothing is copied anywhere (B510 — this used to be a
      # sync step, which is what B56 cost). It is baked into prerendered
      # pages, so it builds.
      site/*)
        do_build=1 do_restart=1 ;;

      # content/ belongs to the people on it, and a deploy never touches it —
      # including content/example, which is seeded by hand. Said out loud
      # rather than silently skipped, because "I edited the example journal
      # and deployed" is a reasonable thing to have expected to work.
      content/*)
        note "content/ changed — a deploy does not copy it into \$CONTENT_DIR" ;;

      # systemd units, and the proxy config that is only ever reported on.
      deploy/*.service | deploy/*.timer | deploy/*.socket | deploy/*.target)
        do_units=1 do_restart=1 ;;
      # The private features tree's own units, when the open-core split has
      # landed and it ships any — see install-units.sh's PAID_UNIT_SRC. `paid/`
      # itself is never pulled here (its own diff is classified separately,
      # below), but a unit file arriving with it still needs install-units.sh
      # run, or a changed timer is uninstalled the same silent way B138 was.
      paid/deploy/*.service | paid/deploy/*.timer | paid/deploy/*.socket | paid/deploy/*.target)
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

full_plan() { do_install=1 do_migrate=1 do_build=1 do_units=1 do_caddy=1 do_restart=1; }

# Does this instance's own config ask for a capability that the open-core
# split's private features tree (`paid/`) actually implements? Read straight
# from the effective config path (lib/config.ts's own `serverConfigPath()`
# resolution: FERNSCOUT_CONFIG first, then the checkout's site/config.json —
# deploy.sh runs before ENV_FILE's DATA_DIR-based legacy path would apply, and
# this check only needs "did the operator turn one of these on", not the full
# fallback chain). `exit 0` means "yes, something is requested" — the ordinary
# shell convention this script's own caller already assumes.
#
# The list is the same four+one capabilities lib/capabilities.ts documents as
# depending on paid/-shaped provider code today; a future capability that
# joins them belongs in this array too.
paid_feature_requested() {
  local config="${FERNSCOUT_CONFIG:-$APP_DIR/site/config.json}"
  [ -f "$config" ] || return 1
  node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const names = ["photobook", "postcards", "whatsapp", "whatsappInbound", "credits"];
      const requested = names.some((n) => c?.features?.[n]?.enabled === true);
      process.exit(requested ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$config"
}

# The plan, in the order it will run, one line per step. Printed before
# anything happens: a deploy that is about to skip the build should say so
# while there is still time to disagree with it.
print_plan() {
  local yes=0
  [ "$do_install" = 1 ] && { log "will install dependencies"; yes=1; }
  [ "$do_migrate" = 1 ] && { log "will run migrations"; yes=1; }
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

# ---------------------------------------------------------------------------
# B1313: two deploys against the same checkout at once is not hypothetical —
# several agent sessions can ship at once here — and it is the sharpest fault
# this file had: one replaced node_modules while the other built against it,
# both died, and the site was left 502 with a poisoned build.
#
# A directory as the lock, not a lock file a process is trusted to clean up
# after itself: `mkdir` is atomic on every filesystem this runs on (unlike
# `flock`, which is Linux-only and not on this checkout's own dev machine —
# a portable lock beats a lighter one that cannot be exercised or shipped
# everywhere this script runs). It holds the PID that made it, so a *live*
# holder refuses the second deploy outright — a second deploy usually means a
# second session about to report success it never achieved — while a *dead*
# one, the exact trap the ticket warned a naive lock falls into, is detected
# with `kill -0` and reclaimed right here, logged, with nothing for an
# operator to find or delete by hand, ever.
# ---------------------------------------------------------------------------
LOCK_DIR="${LOCK_DIR:-$APP_DIR/.deploy.lock}"
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$LOCK_DIR/pid"
    return 0
  fi
  local held
  held="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$held" ] && kill -0 "$held" 2>/dev/null; then
    echo "ERROR: another deploy (pid $held) is already running against $APP_DIR." >&2
    echo "       Wait for it to finish. Nothing to clear by hand: a crashed deploy's" >&2
    echo "       lock is detected and reclaimed automatically the next time this runs." >&2
    exit 1
  fi
  log "clearing a stale lock left by pid ${held:-unknown} (no longer running)"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  echo $$ > "$LOCK_DIR/pid"
}
acquire_lock
trap 'rm -rf "$LOCK_DIR"' EXIT

# What is actually serving right now (B559) — asked of the running process
# itself, not trusted from $STATE_FILE. The file used to be the only record
# of "the last commit this script brought up healthy", and it advanced on
# every healthy check regardless of whether a build or restart had actually
# run: a `git diff` that a bug in `classify` mis-read as build-irrelevant
# still moved $STATE_FILE forward, so the missed change dropped out of every
# later diff and never got built. /api/health's `commit` field is the git
# SHA the *running* build was compiled from (only ever written when this
# script actually restarts the service, in "recording GIT_SHA=" below), so
# querying it live means a run that skipped a build for the wrong reason
# still diffs from the truth next time, not from its own mistake.
#
# $STATE_FILE is now only the bootstrap for when nothing answers yet — a
# fresh machine before the service has ever been started once.
# /api/health, with the detail this caller is entitled to.
#
# The page redacts `lastSuccessAt`, `ageHours` and `reason` from anyone without
# `HEALTH_TOKEN` (B1045), which is right and is not softened here. But this
# script runs on the server, has sourced $ENV_FILE above, and holds the token —
# and asking anonymously is how `report_backup` came to print `backup: ok (last
# success )` on every deploy, and `WARNING: backup failing —` with the reason
# cut off on the one run where the line matters. B1698.
#
# Not `-H`: an argv is `/proc/<pid>/cmdline` and the service user can read it.
# --config keeps the token on stdin. An unset token stays anonymous, so a fresh
# install with no HEALTH_TOKEN behaves exactly as before, trimmed line and all.
fetch_health() {
  local url="http://127.0.0.1:${PORT:-3000}/api/health"
  if [ -n "${HEALTH_TOKEN:-}" ]; then
    curl -fsS --config - "$url" 2>/dev/null <<CONFIG
header = "Authorization: Bearer ${HEALTH_TOKEN}"
CONFIG
  else
    curl -fsS "$url" 2>/dev/null
  fi
}

served_commit() {
  local health
  health="$(fetch_health)" || return 1
  printf '%s' "$health" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).commit;process.stdout.write(c?String(c):"")}catch{}})' \
    2>/dev/null
}

# The features tree's own commit, the same way served_commit() reads the
# app's — from /api/health's `paidCommit` field, absent on a public-only
# instance. See §1c below for STATE_FILE_PAID, its `.deploy-state`-style
# fallback for the bootstrap case.
served_paid_commit() {
  local health
  health="$(fetch_health)" || return 1
  printf '%s' "$health" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).paidCommit;process.stdout.write(c?String(c):"")}catch{}})' \
    2>/dev/null
}

DEPLOYED=""
LIVE="$(served_commit || true)"
# B1: a live answer is only trustworthy when this checkout's history actually
# contains it. A checkout whose history is discontinuous with what the running
# process was built from (a cutover, a rolled-back-then-reused tree) makes
# `git diff "$LIVE" "$HEAD_SHA"` fail with `fatal: bad object`, a hard,
# unexplained exit under `set -euo pipefail` on what reads like an ordinary
# deploy — so the commit is checked here the same way $STATE_FILE's own
# fallback already is below, before it is trusted as a diff baseline.
if [ -n "$LIVE" ] && as_service git cat-file -e "${LIVE}^{commit}" 2>/dev/null; then
  DEPLOYED="$LIVE"
  log "asked ${SERVICE} what it is serving: ${DEPLOYED:0:12}"
elif [ -n "$LIVE" ]; then
  log "${SERVICE} reports ${LIVE:0:12} as serving, but this checkout has no such commit — deploying in full"
elif [ -f "$STATE_FILE" ]; then
  DEPLOYED="$(tr -dc '0-9a-f' < "$STATE_FILE" | head -c 40)"
  if [ -z "$DEPLOYED" ] || ! as_service git cat-file -e "${DEPLOYED}^{commit}" 2>/dev/null; then
    log "$STATE_FILE names no commit this repository has — deploying in full"
    DEPLOYED=""
  fi
fi

# The private features tree, when this instance uses it. It reaches this box
# as an upload from the laptop harness (ship.sh, run before this script),
# never as a git clone or pull — the VPS holds no credential for
# fernscout-features and never asks GitHub for it. A public-only instance
# never has $APP_DIR/paid and that is a supported deployment — the same shape
# as "no DATABASE_URL" above. What is NOT supported is a paid feature switched
# on in config with no tree to satisfy it: that instance would build against
# `@paid/*` stub fallbacks silently and serve a feature the operator believes
# is real. This whole check is inert — never refuses, never even looks at
# config — until `lib/paid-stubs/` actually exists in the checkout, i.e. until
# the open-core split has landed: before that, every paid feature this
# instance runs (fernscout.ch today) has no stub fallback to fall silently
# back to, and refusing here would only break deploys the split has not
# reached yet.
PAID_DIR="$APP_DIR/paid"
PAID_SHA=""
if [ -f "$PAID_DIR/.sha" ]; then
  PAID_SHA="$(tr -dc '0-9a-f' < "$PAID_DIR/.sha" | head -c 40)"
  log "paid/ present at ${PAID_SHA:0:12} (uploaded, not pulled)"
elif [ -d "$APP_DIR/lib/paid-stubs" ] && paid_feature_requested; then
  echo "ERROR: site/config.json asks for a paid feature but $PAID_DIR (or its .sha) is missing." >&2
  echo "       Upload it: run .claude/skills/vps/ship.sh from the laptop harness, which" >&2
  echo "       archives the local paid/ checkout and installs it here before deploying," >&2
  echo "       or turn the feature back off." >&2
  exit 1
fi

# The paid SHA this box last built against, the same live-first /
# state-file-fallback shape as $DEPLOYED above — but with no git history to
# validate against, since `paid/` is a plain uploaded tree, not a clone.
STATE_FILE_PAID="${STATE_FILE_PAID:-$APP_DIR/.deploy-state-paid}"
DEPLOYED_PAID=""
LIVE_PAID="$(served_paid_commit || true)"
if [ -n "$LIVE_PAID" ]; then
  DEPLOYED_PAID="$LIVE_PAID"
  log "asked ${SERVICE} what paid/ it is serving: ${DEPLOYED_PAID:0:12}"
elif [ -f "$STATE_FILE_PAID" ]; then
  DEPLOYED_PAID="$(tr -dc '0-9a-f' < "$STATE_FILE_PAID" | head -c 40)"
fi

# B1313: a checkout left on a detached HEAD — the state a hand-build recovery
# leaves it in — fails `git pull --ff-only` with git's own "you are not
# currently on a branch", which says nothing about deploy.sh or what to do
# about it. Say both, and stop before anything else runs.
if ! as_service git symbolic-ref -q HEAD >/dev/null; then
  DETACHED_AT="$(as_service git rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "ERROR: $APP_DIR is not on a branch (detached HEAD at ${DETACHED_AT})." >&2
  echo "       Reattach it, but only if it has not diverged from the branch you deploy:" >&2
  echo "         git merge-base --is-ancestor main HEAD && git checkout main" >&2
  echo "       If that check fails, the branch has diverged — that is a person's decision," >&2
  echo "       not this script's." >&2
  exit 1
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

# Evaluated after the whole app-diff chain above, on its own, unconditionally
# (skipped only under --full, which full_plan() already set everything for) —
# a paid-only push must cost a build+restart whether or not anything in the
# app repo changed this run. Nested inside the app's own `else` branch above,
# this would never run when the app is unchanged, which is exactly the one
# case it exists for: an instance already "at HEAD" and reported healthy, with
# nothing but a new paid/ upload since.
if [ "$MODE" != full ] && [ -n "$PAID_SHA" ] && [ -n "$DEPLOYED_PAID" ] && [ "$DEPLOYED_PAID" != "$PAID_SHA" ]; then
  log "paid/ changed since ${DEPLOYED_PAID:0:12} — build + restart"
  do_build=1 do_restart=1
fi

print_plan

if [ "$do_install" = 1 ]; then
  log "installing dependencies (npm ci — exact lockfile)"
  as_service npm ci
else
  skip "install" "package-lock.json unchanged"
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
  # B1311: a config.json the service user cannot read is invisible until a
  # build touches it — `app/opengraph-image.tsx` reads it at module scope, so
  # `next build` fails deep into page collection, and by then it has already
  # cleared .next. Checking first means a build that cannot possibly succeed
  # never gets the chance to delete the build that is serving.
  CONFIG_PATH="${FERNSCOUT_CONFIG:-}"
  if [ -n "$CONFIG_PATH" ] && [ -f "$CONFIG_PATH" ] \
    && ! as_service head -c1 "$CONFIG_PATH" >/dev/null 2>&1; then
    echo "ERROR: $CONFIG_PATH is not readable by $RUN_AS — the build would fail on it," >&2
    echo "       taking .next down with it. Fix ownership first:" >&2
    echo "         chown $RUN_AS:$RUN_AS $CONFIG_PATH" >&2
    exit 1
  fi

  # B2230: build into $BUILD_DIR, never into the .next the running server is
  # reading. `next build` rewrites its distDir as it goes, and the old process
  # kept serving out of the half-written result — ChunkLoadError and "client
  # reference manifest does not exist", a minute of 500s on every deploy
  # (2026-09-24). The new build is swapped in only while the service is
  # stopped, just before it starts again (see "swapping in" below).
  #
  # Three things the separate directory needs:
  # - A clean start. Whatever a failed earlier attempt left in $BUILD_DIR is
  #   not to be trusted, and it is not serving, so it goes.
  # - The Turbopack persistent cache, moved over from .next so the build is
  #   not cold. The running server only uses .next/cache for its image and
  #   fetch caches, which it recreates on a miss.
  # - No .next/types. tsconfig.json includes both .next/types and
  #   $BUILD_DIR/types (so Next never rewrites it — a dirty checkout would
  #   stop the next `git pull --ff-only`), and two copies of the generated
  #   route types collide in the build's own type check (TS2300, duplicate
  #   identifier). The server does not read them; they are compile-time only.
  as_service rm -rf "$BUILD_DIR" .next/types
  as_service mkdir "$BUILD_DIR"
  # The Turbopack cache never prunes itself: 76 GB on fernscout.ch by
  # 2026-09-25. Carried from build to build it grows forever, so past
  # DEPLOY_CACHE_MAX_GB it is dropped and this one build runs cold.
  # Deleted rather than left behind, or it would sit in .next-prev.
  if [ -d .next/cache ]; then
    CACHE_KB="$(du -sk .next/cache | cut -f1)"
    CACHE_MAX_GB="${DEPLOY_CACHE_MAX_GB:-10}"
    if [ "$CACHE_KB" -gt $((CACHE_MAX_GB * 1024 * 1024)) ]; then
      log "turbopack cache $((CACHE_KB / 1024 / 1024)) GB > ${CACHE_MAX_GB} GB — building cold"
      as_service rm -rf .next/cache
    else
      as_service mv .next/cache "$BUILD_DIR/cache"
    fi
  fi

  log "building into $BUILD_DIR"
  BUILD_LOG="$(mktemp)"
  BUILD_OK=1
  as_service env NEXT_DIST_DIR="$BUILD_DIR" npm run build 2>&1 | tee "$BUILD_LOG" || BUILD_OK=0
  if [ "$BUILD_OK" = 0 ]; then
    # B1312/B1313: a poisoned Turbopack persistent cache panics on whichever
    # page happens to collect first, which reads like a fault in that page and
    # is not — the incidents here were cleared only by `rm -rf .next
    # node_modules/.cache .turbo`. Since B2230 the cache lives in $BUILD_DIR,
    # so clearing it never touches the .next that is still serving.
    if grep -qiE 'turbo-persistence|panicked at|chunk_path requires an asset' "$BUILD_LOG"; then
      log "build panicked inside Turbopack — clearing the persistent cache and retrying once"
      rm -f "$BUILD_LOG"
      as_service rm -rf "$BUILD_DIR" node_modules/.cache .turbo
      as_service env NEXT_DIST_DIR="$BUILD_DIR" npm run build
    else
      rm -f "$BUILD_LOG"
      exit 1
    fi
  fi
  rm -f "$BUILD_LOG"

  # And then: is what it wrote complete? — B1429.
  #
  # `next build` exits 0 on a `.next` that is missing a page's client
  # reference manifest, and the page 500s on the first request after the
  # restart. It happened here on 2026-09-11 and every gate missed it: the
  # build was green, /api/health was green (it renders no page), and the
  # broken route was owner-only, so nothing an unauthenticated check could
  # reach would have touched it. `scripts/check-build.mjs` says why this is
  # the shape of the check.
  #
  # The remedy is the one the incident itself proved: build again. The second
  # build of that same commit wrote the missing file and served the page.
  # Into $BUILD_DIR again (B2230), so the running site is untouched either
  # way. If a plain rebuild is ever not enough, this fails and says so, which
  # is the point.
  #
  # Logged as its own step, and that is not decoration. This whole ticket is
  # about a gate nobody could see: an operator reading a deploy scans the
  # `==>` lines, and a bare line of output after a page of build chatter is
  # not one of them. A check you cannot tell ran is the state we started in.
  log "checking the build"
  if ! as_service node scripts/check-build.mjs "$BUILD_DIR"; then
    log "the build is incomplete — building again before going near the restart"
    as_service env NEXT_DIST_DIR="$BUILD_DIR" npm run build
    if ! as_service node scripts/check-build.mjs "$BUILD_DIR"; then
      echo "ERROR: two builds of ${HEAD_SHA:0:12} both left pages without a client reference manifest." >&2
      echo "       Nothing was restarted or swapped, so the previous build is still serving." >&2
      echo "       Try: cd ${APP_DIR} && rm -rf ${BUILD_DIR} node_modules/.cache .turbo && sudo ./scripts/deploy.sh --full" >&2
      exit 1
    fi
  fi
else
  skip "build" "nothing the build reads changed"
fi

# The currency reference rates, which this deploy may just have deleted.
#
# B1084 took `site/rates/ecb.json` out of git and moved the table under
# DATA_DIR, so the `git pull` above removes the checkout copy from any instance
# that last deployed before that change — and the nightly refresh in
# scripts/backup.sh will not run until 03:20. Without this line, every costs
# page on the instance would offer nothing but its base currency until then.
#
# Cheap, idempotent, and it decides for itself: nothing happens on an instance
# with `costs` switched off, and a failure leaves whatever table is already
# there. Never fatal — a deploy that reached this point has already built and
# is about to restart, and reference rates are not worth aborting that for.
log "refreshing the currency reference rates"
if as_service npm run --silent rates:update; then
  :
else
  echo "    WARNING: could not refresh the rates — the instance keeps whatever table it has" >&2
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
# B2230: the new build goes live by two renames while the service is stopped —
# .next → .next-prev, $BUILD_DIR → .next — and never while the old process is
# up: it resolves chunks by path, so a swap under it would be the same
# mismatch as building in place. The stop/start pair costs exactly what
# `systemctl restart` did. .next-prev is one generation back, for a rollback
# by hand (docs/runbook.md), and is removed *before* the stop so a failure to
# remove it aborts with the old site still serving.
swap_in_build() {
  if [ -d .next ]; then as_service mv .next .next-prev || return 1; fi
  as_service mv "$BUILD_DIR" .next && return 0
  if [ -d .next-prev ] && [ ! -e .next ]; then as_service mv .next-prev .next; fi
  return 1
}

if [ "$do_restart" = 1 ] && [ "$do_build" = 1 ]; then
  as_service rm -rf .next-prev
  log "stopping ${SERVICE} to swap in the new build"
  sudo systemctl stop "$SERVICE"
  if ! swap_in_build; then
    # The drop-in below has not been written yet, so what starts is labelled
    # truthfully with the commit it was built from.
    sudo systemctl start "$SERVICE"
    echo "ERROR: could not move ${BUILD_DIR} into place — ${SERVICE} was started again on the previous build." >&2
    exit 1
  fi
fi

if [ "$do_restart" = 1 ]; then
  log "recording GIT_SHA=${HEAD_SHA:0:12}"
  if [ "$(id -u)" -eq 0 ]; then
    mkdir -p "/etc/systemd/system/${SERVICE}.service.d"
    printf '[Service]\nEnvironment=GIT_SHA=%s\n' "$HEAD_SHA" \
      > "/etc/systemd/system/${SERVICE}.service.d/git-sha.conf"
    # Only when there is a features tree to name — an empty PAID_SHA= would
    # relabel a public-only instance with a features commit it never had, and
    # /api/health treats an unset PAID_SHA as "no features repo," not a lie.
    if [ -n "$PAID_SHA" ]; then
      printf 'Environment=PAID_SHA=%s\n' "$PAID_SHA" \
        >> "/etc/systemd/system/${SERVICE}.service.d/git-sha.conf"
    fi
    systemctl daemon-reload
  fi

  log "restarting ${SERVICE}"
  # Already stopped above when there was a build to swap in; `restart` starts
  # a stopped unit, so one line serves both.
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
    false) log "logging: off (features.logging.enabled in site/config.json)" ;;
    *) ;;  # an older build with no logging capability at all
  esac
}

# Whether this server can take a clip at all — B693.
#
# ffmpeg is not an npm dependency and nothing here installs it: a deploy runs
# on every push, as root, and one that quietly `apt install`s changes the
# machine on a docs-only push. Provisioning is docs/runbook.md's job, and has
# to work on a VPS that is not Debian.
#
# So this reports, in the same breath as backup and logging. fernscout.ch ran
# for months advertising mp4, mov and webm with no ffmpeg on the box, refusing
# every clip after the upload, and no deploy ever mentioned it. `videoFormats`
# is empty exactly when the tools are missing (B692), which is what this reads.
report_video() {
  local health="$1"
  local formats
  formats="$(printf '%s' "$health" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const f=JSON.parse(s).media?.videoFormats;process.stdout.write(Array.isArray(f)?String(f.length):"")}catch{}})' \
    2>/dev/null)" || formats=""
  case "$formats" in
    "") ;;  # an older build, or no node to read the answer with
    0) log "video: off — ffmpeg is not installed, so clips are refused (apt install ffmpeg)" ;;
    *) log "video: on (${formats} formats)" ;;
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
  if [ -n "$PAID_SHA" ]; then
    printf '%s\n' "$PAID_SHA" > "$STATE_FILE_PAID.tmp" && mv "$STATE_FILE_PAID.tmp" "$STATE_FILE_PAID"
    chown "$RUN_AS" "$STATE_FILE_PAID" 2>/dev/null || true
  fi
}

log "waiting for health"
for i in $(seq 1 30); do
  if HEALTH="$(fetch_health)"; then
    log "healthy"

    # The loud version of the footnote B559 nearly missed: this run just
    # restarted the service *because* it believed new code needed to go
    # live, so what answers now must be the commit it restarted onto. If it
    # is not, the restart did not actually adopt the new build — a wedged
    # process that failed to exit, a build that silently produced nothing —
    # and a deploy that reports success on the old code is worse than one
    # that fails loudly here. Only checked when a restart was supposed to
    # bring HEAD_SHA up: a run that correctly decided nothing needed
    # rebuilding is *expected* to still be serving an older commit, and that
    # is not a failure.
    SERVED="$(printf '%s' "$HEALTH" | node -e \
      'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).commit;process.stdout.write(c?String(c):"")}catch{}})' \
      2>/dev/null)" || SERVED=""
    if [ "$do_restart" = 1 ] && [ -n "$SERVED" ] && [ "$SERVED" != "$HEAD_SHA" ]; then
      echo "ERROR: restarted ${SERVICE} for ${HEAD_SHA:0:12} but /api/health reports ${SERVED:0:12} is serving. The restart did not adopt the new build — check journalctl -u ${SERVICE} -n 50 before trusting this deploy." >&2
      exit 1
    fi

    record_deployed
    report_backup "$HEALTH"
    report_logging "$HEALTH"
    report_video "$HEALTH"
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
