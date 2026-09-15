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

# The journal name reaches four places that cannot defend themselves: an `ssh`
# command line **as root on the live box**, two JSON bodies built by string
# concatenation, and a /tmp path. `foo; rm -rf /var/lib/fernscout` in the
# second argument would have run on the server.
#
# `lib/users.ts`'s own `USERNAME_RE`, which is the set of names that can
# actually exist — so nothing legitimate is refused, and one check covers all
# four sites rather than four different quotings that have to stay right
# forever. A name is also a directory name and therefore a security boundary,
# which is the same reason `lib/trips.ts` insists on `tripRef()`.
if [[ ! "$JOURNAL" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]]; then
  echo "not a journal name: '$JOURNAL' (a-z, 0-9 and dashes, 2–31 characters)" >&2
  exit 64
fi

case "$WHERE" in
  live) BASE=https://fernscout.ch; REMOTE=1 ;;
  http://*|https://*) BASE="$WHERE"; REMOTE=0 ;;
  # Anything else would be handed to curl as a URL and to nothing else, but a
  # base that is not a URL is a mistake worth naming rather than a request
  # worth making.
  *) echo "not a base URL: '$WHERE' (use 'live', or http://localhost:PORT)" >&2; exit 64 ;;
esac

# The mail this instance kept. Live is the server's own outbox under DATA_DIR;
# local is `.data/mail/` in whatever checkout is serving — `dataDir()` is
# DATA_DIR or <cwd>/.data, and mail has not been under content/ since B636.
newest_mail() {
  if [[ "$REMOTE" == 1 ]]; then
    # Interpolated into a command line that runs as root on the live box. Safe
    # only because of the check above — do not relax that without quoting this.
    ssh "$VPS_IP" "ls -t /var/lib/fernscout/mail/$JOURNAL/*.eml 2>/dev/null | head -1 | xargs -r cat"
  else
    local f
    f="$(ls -t .data/mail/"$JOURNAL"/*.eml 2>/dev/null | head -1 || true)"
    [[ -n "$f" ]] && cat "$f"
  fi
}

for_val="read"
[[ "$KIND" == agent ]] && for_val="write"

# ── who the journal says it belongs to — B1785 ────────────────────────────
#
# `agent@fernscout.ch` is the instance admin and `isOwner` answers yes for it
# on every journal (B480), which is why the **cookie** below works anywhere:
# it proves an address and the owner pages resolve through `isOwner`.
#
# A write code does not go that way. `agentScope`
# (app/api/auth/codes/redeem/route.ts) compares the address with the journal's
# own `owner.email`, so an unscoped write code for a journal this address does
# not own is refused — and refused as `invalid_code`, indistinguishable from a
# wrong code, with the reason only in the server's log. That is deliberate; it
# is also how a correct code read out of the instance's own outbox comes back
# refused and you go looking at the mail reader.
#
# So this says so BEFORE asking for a code, rather than burning a
# rate-limit slot and a mail to find out. A journal whose config cannot be read
# from here is not blocked — the check is a courtesy, not a gate.
journal_owner() {
  if [[ "$REMOTE" == 1 ]]; then
    # Interpolated into a root command line; safe only because of the
    # USERNAME_RE check above.
    ssh "$VPS_IP" "python3 -c \"import json;print(json.load(open('/var/lib/fernscout/content/$JOURNAL/config.json'))['owner']['email'])\"" 2>/dev/null || true
  else
    local dir
    for dir in "${CONTENT_DIR:-}" .data/content content; do
      [[ -n "$dir" && -f "$dir/$JOURNAL/config.json" ]] || continue
      python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['owner']['email'])" \
        "$dir/$JOURNAL/config.json" 2>/dev/null || true
      return
    done
  fi
}

if [[ "$KIND" == agent ]]; then
  owner="$(journal_owner | tr -d '[:space:]' | tr 'A-Z' 'a-z')"
  if [[ -n "$owner" && "$owner" != "agent@fernscout.ch" ]]; then
    cat >&2 <<REFUSAL
agent@fernscout.ch cannot get a write token for '$JOURNAL' — that journal belongs to
$owner, and a write code with no trip on it is only issued to the journal's own owner
address (agentScope, app/api/auth/codes/redeem/route.ts). The API would answer
invalid_code, which says nothing about why. Nothing was asked for.

What does work:
  $0 $WHERE $JOURNAL cookie     owner PAGES for any journal — the identity cookie
                                proves the address and isOwner covers the admin
  ask $owner for a code, or have them run this
  a trip-scoped code, issued by the owner for one trip
REFUSAL
    exit 3
  fi
fi

body='{"user":"'"$JOURNAL"'","email":"agent@fernscout.ch","for":"'"$for_val"'"}'

# Note the timestamp of the newest mail before asking, so we can tell a fresh
# one from the one that was already there — a code read out of a stale mail is
# refused, and "invalid_code" says nothing about why.
before="$(newest_mail | head -c 200 || true)"

status=$(curl -sS -o /tmp/get-token-request.json -w '%{http_code}' \
  -X POST "$BASE/api/auth/codes" -H 'content-type: application/json' -d "$body")
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

verify='{"user":"'"$JOURNAL"'","email":"agent@fernscout.ch","code":"'"$code"'","for":"'"$for_val"'"}'

if [[ "$KIND" == agent ]]; then
  out="$(curl -sS -X POST "$BASE/api/auth/codes/redeem" -H 'content-type: application/json' -d "$verify")"
  token="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
  if [[ -z "$token" ]]; then
    echo "redeem refused: $out" >&2
    echo "If that is invalid_code on a fresh mail, the address is probably not this journal's" >&2
    echo "own owner (B1785): ssh $VPS_IP 'journalctl -u fernscout -n 20 | grep \"auth\]\"'" >&2
    exit 1
  fi
  echo "$token"
else
  jar="/tmp/fernscout-$JOURNAL-cookies.txt"
  rm -f "$jar"
  out="$(curl -sS -c "$jar" -X POST "$BASE/api/auth/codes/redeem" -H 'content-type: application/json' -d "$verify")"
  if ! grep -q fs_identity "$jar" 2>/dev/null; then echo "redeem refused: $out" >&2; exit 1; fi
  echo "$jar"
fi
