---
name: get-a-credential
description: Get signed in — an agent token, an owner's browser cookie, the operator's /admin, or a throwaway test journal — on a local checkout or on the live instance. Use when something answers 401, 403 or 404 and the reason is that the session is not holding the right credential, when a ticket needs an owner-only page, when driving the API by hand, or when the user asks for an admin token, an admin login, or a test user.
---

# Getting in

Four credentials, two instances, and the wrong one looks exactly like a bug in
the thing you were testing. This is the map, and one script that does the whole
round trip.

**Start here.** From the repository root, either instance:

```bash
.claude/skills/get-a-credential/get-token.sh <where> <journal> [agent|cookie]

.claude/skills/get-a-credential/get-token.sh live example cookie      # → a cookie jar path
.claude/skills/get-a-credential/get-token.sh live example agent       # → fs_agent_…
.claude/skills/get-a-credential/get-token.sh http://localhost:3013 example agent
```

It asks for a code, reads the code out of the instance's own kept mail, spends
it, and prints the token or the path to a cookie jar. It always uses
`agent@fernscout.ch`, which is this instance's `FERNSCOUT_ADMIN_EMAIL` and
therefore an owner of every journal (B480).

Everything below is what to do when that is not enough, and why each piece is
shaped the way it is.

**The journal argument is checked against `USERNAME_RE` before anything uses
it, and that check is load-bearing.** The name reaches an `ssh` command line
that runs **as root on the live box**, two JSON bodies built by string
concatenation, and a `/tmp` path — so `example; rm -rf /var/lib/fernscout`
would have run there. One check at the top covers all four rather than four
quotings that each have to stay right forever. If you extend this script, do
not relax it, and do not add a fifth interpolation on the assumption that the
argument is clean for some other reason.

## Which credential you actually need

| You want to | Hold | Get it |
| --- | --- | --- |
| call `/api/v1/**` | an **agent token**, `Authorization: Bearer` | `get-token.sh … agent` |
| load an owner-only **page** — `/<user>/contacts`, `/<user>/me`, `/admin` | a **cookie** | `get-token.sh … cookie` |
| prove an address across the whole instance | the **`fs_identity`** cookie | falls out of any sign-in |
| hand an agent its own token from a browser | a **handover** credential | `POST /api/v1/<user>/handover` |

**The two do not substitute for each other, and this is the single most
expensive confusion here.** An agent token reaches `/api/…` and never a
rendered page: a token that drives every write on a trip loads `/admin` as a
**404**. A guest cookie reaches pages and never writes. `resolveSession()`
compares the row's `kind` against what the caller asked for, so this is
enforced rather than conventional — decision 24, so that reading the site on
your phone does not put a credential that can rewrite it in your pocket.

The practical consequence for a ticket: **an acceptance line about what a page
shows cannot be closed over the API.** Write it against the browser, or against
the API state that drives the render.

## `/admin` is opened by `fs_identity` alone

The operator's console reads a **cookie** and asks `resolveIdentity`, not
`resolveAccess` — the question is instance-wide, and one journal's own session
must not answer it. Two things follow, both verified:

- Signing in to **any** journal with `agent@fernscout.ch` opens `/admin`. There
  is no separate admin login and no admin journal.
- The **`fs_identity` cookie on its own is enough**. `fs_session` is not needed:

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: fs_identity=$ID" https://fernscout.ch/admin
  ```

With `FERNSCOUT_ADMIN_EMAIL` unset, `/admin` is a 404 for everybody, which is
how every instance that is not this one behaves. A 404 there is the gate
working, never a missing route — and it is deliberately a 404 rather than a
403, because a page that says "forbidden" has told a stranger the console is at
this address.

## Locally

```bash
DATABASE_URL="sqlite:.local-dev.db" \
SESSION_SECRET="local-dev-only-not-a-real-secret-000000" \
FERNSCOUT_ADMIN_EMAIL="agent@fernscout.ch" \
AUTH_DEV_CODE=123456 \
PORT=3013 npm run dev
```

`DATABASE_URL` is **not** defaulted — without it every page 500s with *"No
database is configured"*. Copy `.local-dev.db` from the main checkout into a
fresh worktree; it is gitignored and carries the demo journal's credits.

**`AUTH_DEV_CODE` fixes every code to that value**, so there is no mail to
read at all:

```bash
curl -s -X POST localhost:3013/api/auth/request -H 'content-type: application/json' \
  -d '{"user":"example","email":"agent@fernscout.ch","kind":"agent"}'
curl -s -X POST localhost:3013/api/auth/verify -H 'content-type: application/json' \
  -d '{"user":"example","email":"agent@fernscout.ch","code":"123456","kind":"agent"}'
```

Set it in the dev command and nowhere else: an instance that has it set has no
sign-in security at all.

**When you copy a database between worktrees, take the `-wal` and `-shm` files
too, or delete all three.** SQLite keeps recent writes in the write-ahead log,
so replacing `.local-dev.db` alone leaves the old rows live — this cost a round
of "the migration did not run" when the truth was that the previous run's table
was still being served out of `.local-dev.db-wal`.

## On the live instance

`features.mail.keepCopy` is on, so **every message this server sends is also on
its disk** under `/var/lib/fernscout/mail/<journal>/`, swept after two days.
That is what makes a mail-gated flow drivable from a session: the gate is still
the gate, and you are reading the operator's own copy of what went through it.

```bash
ssh 95.216.112.173 'ls -t /var/lib/fernscout/mail/example/*.eml | head -1 | xargs cat' \
  | python3 .claude/skills/get-a-credential/read-code.py
```

Use the IP, never `root@fernscout.ch` — the known_hosts entry is against the
address. `curl`, never Python's `urllib`: a bare `python3` on macOS ships no CA
bundle and dies at `CERTIFICATE_VERIFY_FAILED` before the call leaves the
machine.

### Reading a code by hand is three traps deep

`read-code.py` exists because every one of these has cost somebody a round:

- **The live server writes base64 bodies; a local dev mailbox writes
  quoted-printable.** The `vps` skill said quoted-printable for both and was
  wrong about the live one. Try both.
- **The two mails word it differently.** A sign-in mail says *"Or sign in by
  hand with this code: 005722"*; an agent mail says *"Your code is 427903"*. A
  regex anchored on either phrase misses the other, so match any six-digit run
  in a decoded body — nothing else in either mail is six digits.
- **A code may begin with a zero.** `005722` is a real one from this instance,
  and `int()` turns it into a five-digit code that is refused with no
  explanation.

And read the mail in the same run that caused it: the newest code revokes every
older one for that address, so a stale `.eml` gives `invalid_code`.

### The rate limits set the pace, not the network

| Bucket | Cap |
| --- | --- |
| `auth-request-agent` | 5 / 15 min |
| `auth-request` (guest) | 10 / 15 min |
| `auth-verify` | 20 / 15 min |

Five journals per quarter of an hour is the ceiling for anything needing a
fresh token each. Sleep between batches; do not reach for `X-Forwarded-For` to
widen them.

## A test journal

**Name it `test-<something>` and never anything that reads like a person's.**
`test:` is a field on content and a journal has none, so the directory name is
the only label that survives an export, a backup and an `ls` — and it is what
lets anybody delete the thing without stopping to find out whose it is.

A journal is a directory with a `config.json`, and that is the whole of it.
Nothing registers it, no script creates it, and **no restart is needed** — it
is live as soon as the file is valid.

```json
{
  "title": "Test scratch",
  "owner": { "name": "Test", "nickname": "Test", "email": "agent@fernscout.ch" },
  "defaultLocale": "en",
  "locales": ["en"],
  "baseCurrency": "CHF",
  "features": { "auth": { "enabled": true }, "mail": { "enabled": true } }
}
```

**`owner.nickname` is required** and its absence is the one failure you will
hit: the journal is skipped, every page 404s, and `/api/auth/verify` answers
`invalid_code` because no code was ever issued for a journal that does not
exist. The server says so plainly — read it rather than guessing:

```
[users] test-scratch/config.json is unusable, skipping: [ 'owner must be { name, nickname, email? }' ]
```

Give it `agent@fernscout.ch` as the owner so the admin address owns it and
`get-token.sh` works against it unchanged.

Locally that is `content/test-scratch/config.json`. On the live instance:

```bash
ssh 95.216.112.173 'mkdir -p /var/lib/fernscout/content/test-scratch && cat > /var/lib/fernscout/content/test-scratch/config.json <<JSON
{ …the config above… }
JSON
chown -R fernscout:fernscout /var/lib/fernscout/content/test-scratch'
```

`fernscout:fernscout` matters — a directory root owns is one the app cannot
write into, and the failure surfaces much later as a refused upload.

**Take it away when you are done**, and take its mailbox with it:

```bash
ssh 95.216.112.173 'rm -rf /var/lib/fernscout/content/test-scratch /var/lib/fernscout/mail/test-scratch'
```

`rm -rf` rather than `DELETE /api/v1/<user>`: the API route deletes nothing and
answers `202`, mailing a single-use link to a page with a button (B38). That is
the right path for a real journal and a slow one for a scratch directory you
made ninety seconds ago. Removing the directory by hand leaves **no tombstone**,
so the name is immediately free again — which is what you want here and is
exactly what you do *not* want for somebody's real journal.

## Handing a token to another agent

An owner's browser session can mint a **handover** credential: twenty minutes,
scope `exchange:token`, refused on every route except one.

```bash
curl -s -b "$JAR" -X POST localhost:3013/api/v1/example/handover \
  -H 'content-type: application/json' -d '{}'
# → {"handover":"fs_handover_…","minutes":20}

curl -s -X POST localhost:3013/api/auth/handover -H "Authorization: Bearer fs_handover_…"
# → {"token":"fs_agent_…","expiresAt":…}
```

It is **single use** — spending it twice answers `invalid_handover`. Twenty
minutes rather than printing the seven-day token directly, because a week-long
credential would otherwise sit in a clipboard, a screenshot and a scrollback.

## Getting a cookie into a real browser

`fs_session` is `HttpOnly`, so `document.cookie` cannot set it — and in the
chrome-devtools MCP browser it silently does nothing at all, returning `""`
with no error. Use the Playwright MCP and set it on the context; `HttpOnly` is
a browser-side flag, and the server only reads the header.

```js
async (page) => {
  await page.context().addCookies([
    { name: 'fs_session',  value: 'fs_guest_…',    domain: 'localhost', path: '/' },
    { name: 'fs_identity', value: 'fs_identity_…', domain: 'localhost', path: '/' },
  ]);
  await page.goto('http://localhost:3013/admin');
}
```

Read the values straight out of the jar:

```bash
grep -E "fs_session|fs_identity" "$JAR" | awk '{print $6"="$7}'
```

`test-in-a-browser` is the rest of that procedure — viewport, `<details>`,
console errors, and what a screenshot can and cannot tell you.

## When it still will not let you in

- **404 on `/admin`** — the address is not `FERNSCOUT_ADMIN_EMAIL`, or the
  variable is unset on that instance. Check with
  `ssh 95.216.112.173 'grep ADMIN /etc/fernscout/env'`.
- **404 on an API route with a good token** — a *page* is being asked for with
  a bearer token, or the capability is off. `/api/health` says which and why.
- **`invalid_code`** — a stale mail, a leading zero eaten, or the journal does
  not exist. The request answers `202` for all three, deliberately: a different
  answer for a known address than an unknown one turns the endpoint into a way
  of asking who is registered.
- **`403` asking for an agent code** — that address is neither the owner nor on
  the trip. Name the trip:
  `{"user":"…","email":"…","kind":"agent","trip":"<trip-id>"}`.
- **Locally, everything 500s** — `DATABASE_URL` is not set.
