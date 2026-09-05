# Running it locally, the way it actually runs

`npm run dev` is for writing code. This is for the other thing: seeing what a
visitor sees, before a deploy does.

The two differ in ways that matter. `next dev` compiles on demand, never
registers the service worker for real, and re-reads content on every request.
A production build prerenders, caches, and puts a service worker in the
browser that will outlive the build that installed it. Most of the bugs worth
catching before a deploy only exist on the second one.

For deploying to the VPS, see [runbook.md](runbook.md). For *what* to test once
it is running, see [TESTING.md](TESTING.md).

---

## The plain case

```bash
npm run build && npm start          # http://localhost:3000
PORT=3700 npm start                 # somewhere else
```

Everything public works with no configuration at all: the landing page, each
journal, trips, days, gallery, map, costs, the feed, the sitemap and
`/api/health`. A fresh clone has `example` in it, so there is something to
look at immediately.

## Three things that will cost you an hour

### Never build while a server is serving the same directory

`npm run build` rewrites `.next` underneath a running `npm start`. The server
carries on with a half-replaced build and throws 500s on pages that are
perfectly fine — including, in the case that prompted this note, every day
page on the site.

It looks exactly like a regression you just introduced. It is not. Stop the
server, build, start it again:

```bash
lsof -ti:3000 | xargs kill -9      # whatever port it is on
npm run build && npm start
```

Or, to check a change *without* stopping what is already running, build
somewhere else:

```bash
NEXT_DIST_DIR=.next-preview npm run build
NEXT_DIST_DIR=.next-preview PORT=3700 npm start
```

`.next-preview` is gitignored and the server on 3000 never notices. Next will
add `.next-preview/types/**` to `tsconfig.json` while you do this — that is an
artefact of the preview, not a change to the project. Discard it.

### The service worker is real here, and it outlives the build

In production mode `public/sw.js` is registered for real, and it is written for
somebody on a bus with a bad connection: it answers from cache first and
revalidates behind that. Which means, on your laptop, that it will happily show
you the *previous* build and give you no sign that it is doing so. The symptom
is a page that seems to hang on "rendering…", or a change that did not take.

The reliable answer is a fresh incognito window, which starts with no worker.
Failing that, DevTools → Application → Service Workers → **Unregister**, then a
hard reload. Or from the console:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
```

`VERSION` in `public/sw.js` is bumped whenever its behaviour changes, which
retires old caches on the next visit — but only on the *next* visit, so it does
not help you in the moment.

### `SESSION_SECRET`, if anything is locked

Needed as soon as `features.auth` or `features.signup` is on: it is what those
two capabilities require, so without it `lib/capabilities.ts` reports them off
and `/api/auth/request` answers 404. Nobody can prove an address, so nobody can
be let into a closed trip. That is the designed behaviour — an optional
capability is absent rather than half-working — rather than a crash, but you
still cannot get in.

```bash
SESSION_SECRET=$(openssl rand -hex 32) npm start
```

A throwaway value is fine locally. Changing it invalidates every guest cookie
already issued, which on your own machine is nothing.

### Address lookup, and what leaves the server

`features.addressLookup` (B399) turns the street field in every contact form
into suggestions as somebody types. Off by default, like everything else here.
On, a server route proxies each query to a geocoder — Photon
(`photon.komoot.io`) unless `features.addressLookup.url` names another —
so the provider never sees a reader's IP, and the key (if the provider needs
one) never reaches the browser. Nothing is sent until a person has typed at
least `MIN_QUERY_LEN` characters into that field themselves; what is sent is
exactly those characters. The form itself only carries the short attribution
line the suggestions require while they are on screen (B416) — this is the
place for the fuller account of where a query goes.

---

## Opening an owner-only page

`/<user>/photobook`, `/<user>/contacts`, the postcard preview and the credits
page all answer 404 to everybody but the journal's owner, and `isOwner` has no
development shortcut on purpose — an environment variable that makes you an
owner is a thing that eventually ships. So the way in locally is the way in
everywhere: request a code, read it, redeem it.

It works with no accounts. Mail written to a file is a real transport, and the
one-time code is in the file.

```bash
# 1. The capabilities the page needs, in content/config.json — the *server's*
#    switches. `credits` is asked of the instance; `photobook` is asked of the
#    journal too, so it needs to be on in content/<user>/config.json as well.
#    Leave `contacts` off unless you have set CONTACTS_ENCRYPTION_KEY: the boot
#    refuses a capability it cannot honour, which is the point of it.
#
#      features.auth.enabled       true
#      features.credits.enabled    true
#      features.photobook.enabled  true            (server *and* journal)
#      features.mail               { enabled: true, transport: "file" }

# 2. A database, and a secret to sign sessions with.
export SESSION_SECRET="anything-long-enough-for-local-use-only"
export DATABASE_URL="file:./.local-dev.db"
npm run db:migrate

npm run dev

# 3. Ask for a code. The field is `user`, not `username` — see below.
curl -s -X POST http://localhost:3000/api/auth/request \
  -H "Content-Type: application/json" \
  -d '{"user":"example","email":"agent@fernscout.ch"}'

# 4. Read it. The terminal prints the path; the body is base64, so decode it
#    rather than grepping the file for six digits.
python3 - <<'PY'
import email, glob, os, pathlib, re
f = max(glob.glob("content/*/mail/*.eml"), key=os.path.getmtime)
msg = email.message_from_string(pathlib.Path(f).read_text())
for part in msg.walk():
    if part.get_content_maintype() == "text":
        body = part.get_payload(decode=True).decode("utf-8", "replace")
        found = re.findall(r"\b\d{6}\b", body)
        if found:
            print(found[0])
            break
PY

# 5. Redeem it **in the browser**, not with curl: the cookies are HttpOnly, so
#    a jar on disk cannot be handed to Chrome. From the site's own console:
#
#      await fetch('/api/auth/verify', { method: 'POST', credentials: 'include',
#        headers: { 'Content-Type': 'application/json' },
#        body: JSON.stringify({ user: 'example', email: 'agent@fernscout.ch',
#                               code: '123456', kind: 'guest' }) })
```

**The field is `user`.** `app/api/auth/request/route.ts` reads `body.user`;
posting `username` leaves it empty and the route answers `202` anyway, because
every address-dependent outcome on that endpoint is a `202` by design — a
status that varied by address would say which of somebody's family is
registered. The cost of that uniformity is that a typo in a field name is
indistinguishable from a wrong address, and it is worth an hour if you do not
know. Nothing is issued, so `login_codes` stays empty and no `[mail]` line is
printed: **an empty `login_codes` table is the tell that a guard returned early
rather than that delivery failed.**

To spend credits locally, grant some: `npm run credits -- grant example 500`.

## Testing the agent surface

Auth, contacts and mail are **off by default** in `content/config.json`, so
`/api/auth/request` answers 404 and there is no way to get a token. That is
deliberate — every optional capability is absent rather than half-working — but
it means trying the agent API needs a few minutes of setup.

Do it against a copy, not your real content:

```bash
cp -R content /tmp/fs-content
```

Then switch the three features on in **both** files — the server config is a
ceiling and the journal's own config is the opt-in, so a feature that is on in
only one of them stays off:

```jsonc
// /tmp/fs-content/config.json          → features
"mail":     { "enabled": true, "transport": "file" },
"auth":     { "enabled": true },
"contacts": { "enabled": true }

// /tmp/fs-content/example/config.json  → features
"auth":     { "enabled": true },
"contacts": { "enabled": true },
"mail":     { "enabled": true }
```

And start it with the secrets those capabilities need:

```bash
CONTENT_DIR=/tmp/fs-content \
SESSION_SECRET=$(openssl rand -hex 32) \
CONTACTS_ENCRYPTION_KEY=$(openssl rand -hex 32) \
DATABASE_URL="file:/tmp/fs-content/dev.db" \
PORT=3700 npm start
```

If you miss one, the server **refuses to start** and names it. That is the
point: finding out at 3am that mail was enabled and `SMTP_HOST` was never set
is the failure this project cannot afford.

> `/api/health` is the other half of that. It reports every capability's
> resolved state and, when one is off, why — per server *and* per journal,
> since those are two different answers. A journal that never switched
> `contacts` on shows `"not enabled by example"` there, which is what explains
> an `/example/contacts` that 404s on a server where contacts are enabled.

### Getting an agent token

No SMTP is involved. `transport: "file"` writes each message as an `.eml` under
`content/<user>/mail/`, and the six-digit code is inside it.

Two things catch people out: the request must say `"kind":"agent"` (without it
you get a *guest* code, which the agent endpoints will not accept), and the
address must be the journal's own `owner.email` — `agent@fernscout.ch` in the
demo content. Anyone listed in a trip's `people:` may also ask, naming that
trip, and gets a token scoped to it and nothing else.

```bash
curl -X POST localhost:3700/api/auth/request -H 'content-type: application/json' \
  -d '{"user":"example","email":"agent@fernscout.ch","kind":"agent"}'
```

Read the code out of the newest file in `/tmp/fs-content/example/mail/` — it is
a MIME message, so the body is base64 and `grep` will not find it:

```bash
python3 - <<'PY'
import email, glob, os, re
f = max(glob.glob("/tmp/fs-content/example/mail/*.eml"), key=os.path.getmtime)
for part in email.message_from_file(open(f)).walk():
    if part.get_content_maintype() == "multipart": continue
    body = part.get_payload(decode=True).decode("utf-8", "replace")
    if m := re.search(r"code is (\d{6})", body): print(m.group(1)); break
PY
```

Then exchange it. The token lasts seven days and is scoped to that journal:

```bash
curl -X POST localhost:3700/api/auth/verify -H 'content-type: application/json' \
  -d '{"user":"example","email":"agent@fernscout.ch","code":"123456","kind":"agent"}'
```

From there, `Authorization: Bearer fs_agent_…` reaches `/api/v1/…`.
`GET /agent.md` is the guide an agent reads, and it is generated from the same
constants the endpoints enforce, so it cannot drift from them.

---

## A closed trip, without touching your own content

There is nothing to generate: a trip is closed by one word in its frontmatter.
Edit a trip's `trip.md` in your **copy**:

```yaml
visibility: guest      # or: private
```

Then reload, and you meet the gate instead of the trip. B39 removed the trip
password — the scrypt hash, the signed cookie, the unlock form and the script
that printed hashes — so nothing in a trip's frontmatter takes a secret any
more. What replaced it is a reader proving an address by e-mail and the owner
granting them access; see `lib/access.ts` for why one shared secret was the
wrong shape.

The two values differ, and the difference is the thing worth seeing locally:
`guest` opens to anyone the owner has approved into the *journal*, `private`
only to the people in the trip's `people:` block. To get past either one you
need `features.auth` on and `SESSION_SECRET` set, above — signing in alone
opens nothing, so you also need a grant (`private` takes none: put your own
address in `people:`).

Editing this on a running server is fine and is worth doing once — content here
is markdown a person edits, and the caches carry a fingerprint of the files
they were built from, so a visibility change takes effect on the next request
with no restart and no rebuild.

## Checking a change before you push

The four that must pass:

```bash
npm run verify         # build → tsc → eslint → vitest, stopping at the first failure
```

The build looks like the expensive one to run first, and it is. It still goes
first, because Next writes the typed-route definitions into `.next/types` while
it builds and `PageProps`, `LayoutProps` and `RouteContext` resolve against
them. Run `tsc` on a checkout that has never been built — a fresh clone, a new
worktree, `main` after a merge that added routes — and you get an error on
every route file, none of them yours. `.github/workflows/ci.yml` builds before
it typechecks for exactly this reason. Once `.next` is warm the order stops
mattering and you can put `tsc` first again if you prefer the faster failure.

Then boot it with a capability both on and off, because "absent when disabled"
is a property that only breaks in one of those two states.

One known flake: `test/cli.test.ts` runs `update-rates`, which fetches live ECB
rates. It fails on a bad connection and passes on a retry.

### What a green run on your laptop did not check

Two things skip when the machine cannot provide them, and both now say so on
stderr with the command that would change it. A skip is not a pass, so read
them:

- **Postgres.** SQLite is what you develop against; Postgres is what the VPS
  runs. `test/db-migrations.test.ts` and `test/db-repos.test.ts` run their
  whole suite against both dialects when `POSTGRES_TEST_URL` points at a
  database they may **wipe**:

  ```bash
  docker run --rm -d --name fernscout-pg -p 5432:5432 \
    -e POSTGRES_USER=fernscout -e POSTGRES_PASSWORD=fernscout \
    -e POSTGRES_DB=fernscout_test postgres:17-alpine
  POSTGRES_TEST_URL=postgres://fernscout:fernscout@localhost:5432/fernscout_test npx vitest run
  ```

- **The restore drill.** `test/backup-script.test.ts` needs `restic` on PATH
  (`brew install restic`) or it skips entirely — every test of the thing that
  would get your photographs back. Its last test additionally needs the
  Postgres above *and* `pg_dump`/`pg_restore` at or above the server's major,
  because pg_dump refuses to dump a server newer than itself. On macOS:
  `brew install libpq && brew link --force libpq`.

None of this is required before pushing: the `backup-drill` job in
`.github/workflows/ci.yml` is the environment where all three exist at once,
and it is where that last test is expected to run (B181). Setting it up locally
is for when CI has failed and you need to see why.

## Where things are while it runs

| | |
| --- | --- |
| `content/` | everything a person owns: the markdown and the photographs |
| `.data/` | reader data — reaction counts, push subscriptions, the SQLite file. `DATA_DIR` moves it, and on a server it **must** point outside the repo so a `git pull` cannot delete it |
| `content/<user>/mail/` | messages, when `transport: "file"`. Delete freely |
| `content/.mail/` | the same, for mail that belongs to no journal yet — signup codes. Delete freely |
| `content/.cache/media/` | resized photographs, rebuilt on demand. Delete freely |
| `.next/` | the build. Delete freely; `npm run build` remakes it |
| `exports/` | `npm run export` output. Gitignored — it holds private trips |

The first two are the ones a backup has to cover, and they are separate on
purpose: `content/` is authored and belongs in git, `.data/` is written by
readers and must not be.
