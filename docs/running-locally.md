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

Needed as soon as a trip carries a `passwordHash:`, or `features.auth` is on.
Without it nobody can be let in: the trip renders its password gate, the unlock
endpoint answers 503, and the log says so once. That is the designed behaviour
rather than a crash, but you still cannot get in.

```bash
SESSION_SECRET=$(openssl rand -hex 32) npm start
```

A throwaway value is fine locally. Changing it invalidates every guest cookie
already issued, which on your own machine is nothing.

---

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
> a `/example/join` that 404s on a server where contacts are enabled.

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

From there, `Authorization: Bearer fs_agent_…` reaches `/api/v1/…` and
`/api/mcp`. `GET /agent.md` is the guide an agent reads, and it is generated
from the same constants the endpoints enforce, so it cannot drift from them.

---

## A locked trip, without touching your own content

```bash
node scripts/trip-password.mjs "a-test-password"
```

Paste what it prints into a trip's `trip.md` in your **copy**:

```yaml
visibility: guest
passwordHash: "scrypt$32768$8$1$…"
```

Then reload. Editing this on a running server is fine and is worth doing once —
content here is markdown a person edits, and the caches carry a fingerprint of
the files they were built from, so a visibility change takes effect on the next
request with no restart and no rebuild.

## Checking a change before you push

The four that must pass, in the order that fails fastest:

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```

Then boot it with a capability both on and off, because "absent when disabled"
is a property that only breaks in one of those two states.

One known flake: `test/cli.test.ts` runs `update-rates`, which fetches live ECB
rates. It fails on a bad connection and passes on a retry.

## Where things are while it runs

| | |
| --- | --- |
| `content/` | everything a person owns: the markdown and the photographs |
| `.data/` | reader data — reaction counts, push subscriptions, the SQLite file. `DATA_DIR` moves it, and on a server it **must** point outside the repo so a `git pull` cannot delete it |
| `content/<user>/mail/` | messages, when `transport: "file"`. Delete freely |
| `content/.cache/media/` | resized photographs, rebuilt on demand. Delete freely |
| `.next/` | the build. Delete freely; `npm run build` remakes it |
| `exports/` | `npm run export` output. Gitignored — it holds private trips |

The first two are the ones a backup has to cover, and they are separate on
purpose: `content/` is authored and belongs in git, `.data/` is written by
readers and must not be.
