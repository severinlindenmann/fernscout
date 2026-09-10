#!/usr/bin/env bash
#
# One credential, from either instance, in one command.
#
#   get-token.sh <where> <journal> [agent|cookie]
#
#   where     live | http://localhost:3013   (any base URL)
#   journal   the username, e.g. example
#   kind      agent  → a Bearer token, prints the token          (default)
#             cookie → a browser session, writes a cookie jar and prints its path
#
# It asks for a code, reads the code out of the instance's own kept mail, and
# spends it. Three steps, each of which somebody has got wrong: the wrong
# field name (`user`, never `username`), the wrong mail directory, and an
# `int()` that ate a leading zero.
#
# Every failure here is loud. A script that half-worked and printed nothing is
# how a session ends up debugging the wrong thing.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VPS_IP=95.216.112.173

WHERE="${1:-}"
JOURNAL="${2:-}"
KIND="${3:-agent}"

if [[ -z "$WHERE" || -z "$JOURNAL" ]]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
fi

case "$WHERE" in
  live) BASE=https://fernscout.ch; REMOTE=1 ;;
  *)    BASE="$WHERE";             REMOTE=0 ;;
esac

# The mail this instance kept. Live is the server's own outbox under DATA_DIR;
# local is `.data/mail/` in whatever checkout is serving — `dataDir()` is
# DATA_DIR or <cwd>/.data, and mail has not been under content/ since B636.
newest_mail() {
  if [[ "$REMOTE" == 1 ]]; then
    ssh "$VPS_IP" "ls -t /var/lib/fernscout/mail/$JOURNAL/*.eml 2>/dev/null | head -1 | xargs -r cat"
  else
    local f
    f="$(ls -t .data/mail/"$JOURNAL"/*.eml 2>/dev/null | head -1 || true)"
    [[ -n "$f" ]] && cat "$f"
  fi
}

body='{"user":"'"$JOURNAL"'","email":"agent@fernscout.ch"'
[[ "$KIND" == agent ]] && body="$body"',"kind":"agent"'
body="$body"'}'

# Note the timestamp of the newest mail before asking, so we can tell a fresh
# one from the one that was already there — a code read out of a stale mail is
# refused, and "invalid_code" says nothing about why.
before="$(newest_mail | head -c 200 || true)"

status=$(curl -sS -o /tmp/get-token-request.json -w '%{http_code}' \
  -X POST "$BASE/api/auth/request" -H 'content-type: application/json' -d "$body")
if [[ "$status" != 202 ]]; then
  echo "asking for a code failed: HTTP $status" >&2
  cat /tmp/get-token-request.json >&2; echo >&2
  exit 1
fi

# The mail is written as the request is served, but a remote read is a second
# round trip; a couple of tries costs nothing and saves a confusing failure.
for _ in 1 2 3 4 5; do
  mail="$(newest_mail || true)"
  [[ -n "$mail" && "$(printf '%s' "$mail" | head -c 200)" != "$before" ]] && break
  sleep 1
done

if [[ -z "${mail:-}" ]]; then
  echo "no mail under $([[ "$REMOTE" == 1 ]] && echo /var/lib/fernscout || echo .data)/mail/$JOURNAL/" >&2
  echo "keepCopy is on for the live instance; locally, features.mail must be enabled." >&2
  exit 1
fi

code="$(printf '%s' "$mail" | python3 "$HERE/read-code.py")"

verify='{"user":"'"$JOURNAL"'","email":"agent@fernscout.ch","code":"'"$code"'"'
[[ "$KIND" == agent ]] && verify="$verify"',"kind":"agent"'
verify="$verify"'}'

if [[ "$KIND" == agent ]]; then
  out="$(curl -sS -X POST "$BASE/api/auth/verify" -H 'content-type: application/json' -d "$verify")"
  token="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
  if [[ -z "$token" ]]; then echo "verify refused: $out" >&2; exit 1; fi
  echo "$token"
else
  jar="/tmp/fernscout-$JOURNAL-cookies.txt"
  rm -f "$jar"
  out="$(curl -sS -c "$jar" -X POST "$BASE/api/auth/verify" -H 'content-type: application/json' -d "$verify")"
  if ! grep -q fs_identity "$jar" 2>/dev/null; then echo "verify refused: $out" >&2; exit 1; fi
  echo "$jar"
fi
