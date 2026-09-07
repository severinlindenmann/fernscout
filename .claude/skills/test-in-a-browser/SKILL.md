---
name: test-in-a-browser
description: Drive a real browser against a local Fernscout checkout — sign in as an owner, turn on a capability, and check a page at phone width. Use when a change is to a page rather than to a function, when curl says nothing useful, or when a ticket's acceptance is about what somebody sees.
---

# Testing in a browser, locally

For when the question is *what does this look like and does it work*, and the
answer is not in a test file. `test-the-live-site` is the other one: that drives
the deployed instance and empties `testing/`. This drives a checkout you are
still changing.

Budget twenty minutes the first time and five after that. Nearly all of it is
getting a signed-in owner in front of a page that is switched on, which is four
obstacles in a row and none of them announce themselves.

## Work in a worktree

Local testing means enabling capabilities, which means editing `site/config.json`
and a journal's `config.json`. Both are tracked. Do it in the main checkout and
another session's `git` command will discard your edits mid-test — the page
starts 404ing and you will look for the bug in your own code. That has happened
here.

Revert the config edits before you commit; they are not part of your change.

```bash
git checkout -- site/config.json content/example/config.json
```

## 1. The database

A fresh worktree has no `.local-dev.db`, and no `.env` either. Copy the one from
the main checkout — it is gitignored, and it carries the demo journal's credits
and any sessions:

```bash
cp ../../../.local-dev.db .          # from inside the worktree
```

`DATABASE_URL` is **not** defaulted. Without it every page 500s with
*"No database is configured"*.

## 2. Turn the capability on, and expect to be refused twice

Every optional capability is off by default (`lib/capabilities.ts`), in
`site/config.json` **and** again per journal in `content/<user>/config.json`.
Both must say yes. The per-journal one is the one people forget — B486 was a
button nobody could reach because no journal named `credits`.

Then the server refuses to boot if a capability is on but unconfigured, and it
tells you exactly what is missing. This is the system working:

```
Some capabilities are enabled but not configured:
  - features.auth is enabled but SESSION_SECRET is not set
```

Turn on only what you need. `contacts` wants `CONTACTS_ENCRYPTION_KEY`; if you
switched it on speculatively, switch it back off rather than inventing a key.

```bash
DATABASE_URL="sqlite:.local-dev.db" \
SESSION_SECRET="local-dev-only-not-a-real-secret-000000" \
FERNSCOUT_ADMIN_EMAIL="agent@fernscout.ch" \
PORT=3001 npm run dev > /tmp/dev.log 2>&1 &
```

Use a port other than 3000 so you do not fight the main checkout's server.
Config is read at boot — **restart after every `config.json` edit**, or you will
debug a change that never loaded.

## 3. Sign in as the owner

An owner-only page (the photobook composer, contacts, credits) needs a real
session row. There is no shortcut: `FERNSCOUT_ADMIN_EMAIL` alone does nothing
without a session.

The field is **`user`**, not `username`. Getting it wrong returns the same
`202` as getting it right — the endpoint answers uniformly on purpose, so a typo
is indistinguishable from a wrong address. The tell is an empty `login_codes`
table.

```bash
curl -s -X POST http://localhost:3001/api/auth/request \
  -H 'content-type: application/json' \
  -d '{"user":"example","email":"agent@fernscout.ch"}'
```

The code is in the newest `.eml` under `content/<user>/mail/`, and the body is
base64 — grepping the file for six digits finds the wrong thing. Decode first:

```bash
f=$(ls -t content/example/mail/*.eml | head -1)
python3 -c "
import sys,base64,re
raw=open('$f',encoding='utf-8',errors='replace').read()
for b in re.findall(r'[A-Za-z0-9+/=]{40,}',raw):
    try:
        d=base64.b64decode(b).decode('utf-8','replace')
        c=re.findall(r'\b(\d{6})\b',d)
        if c: print(c[0]); break
    except Exception: pass
"
```

Then verify into a cookie jar:

```bash
curl -s -c /tmp/wt-cookies.txt -X POST http://localhost:3001/api/auth/verify \
  -H 'content-type: application/json' \
  -d '{"user":"example","email":"agent@fernscout.ch","code":"123456"}'
```

Confirm with a `curl -b /tmp/wt-cookies.txt` against the page before opening a
browser. A `404` here is the capability, not the cookie.

## 4. Get that cookie into the browser

This is the step that wastes the most time.

The session cookie is `HttpOnly`, so `document.cookie` cannot set it — and in
the chrome-devtools MCP browser it silently does nothing at all, returning `""`
with no error. Do not fight it.

**Use the Playwright MCP and set the cookie on the context.** `HttpOnly` is a
browser-side flag; the server only reads the header, so an injected cookie is
accepted normally.

`browser_run_code_unsafe` takes **a bare async arrow function** — not a
statement list, not an IIFE. Both of those fail with confusing syntax errors:

```js
async () => {
  await page.context().addCookies([
    { name: 'fs_session', value: 'fs_guest_…', domain: 'localhost', path: '/' },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  const r = await page.goto('http://localhost:3001/example/photobook');
  return { status: r.status(), title: await page.title() };
}
```

Read the value straight out of the jar:

```bash
grep -E "fs_session|fs_identity" /tmp/wt-cookies.txt | awk '{print $6"="$7}'
```

Signing in through the UI is not an option on a public journal — there is no
guest form to drive.

## 5. Test at 390px

390 × 844 is the design width for anything a reader touches. Test there first
and only then widen; a control that works at 1440 and not at 390 is broken.

Assert what the ticket claims, not that the page rendered:

- **Read state from `localStorage`, not from the DOM.** It is where the
  arrangement actually lives, and it survives a re-render that a snapshot
  catches mid-flight.
- **A hidden element is still in the DOM.** A composer with two levels has two
  copies of a control; `document.querySelector` finds the hidden one first.
  Filter on `offsetParent` before concluding a control is missing or broken.
- **`<details>` starts closed**, so anything inside it is not visible and
  Playwright will time out on it for thirty seconds. Force them open:
  `document.querySelectorAll('main details').forEach(d => d.open = true)`.
- **Wait for the round-trip.** Previews are debounced server calls (400 ms in
  the photobook composer), so allow ~2 s after a change before asserting.
- **Check the console.** `browser_console_messages` with `onlyErrors`. A
  hydration mismatch shows up nowhere else, and one shipped here because the
  stored arrangement was read in a `useState` initialiser instead of an effect.

## When you are done

- Revert the config edits (above).
- Stop the server: `pkill -f "next dev"`.
- Delete any probe test file you wrote. A test that reads `content/` is not one
  to commit — those are real people's trips, and the suite stays off disk.

## What this cannot tell you

It runs against a dev build with the demo journal's content. It will not catch a
production-only capability difference, a Postgres-only query, or anything about
real photographs — the demo originals are generated. For those, deploy and use
`test-the-live-site`.

**A finding that only shows up under `next dev` is not automatically a phantom,
and is not automatically real either.** React's Strict Mode double-invokes
effects in development only, which is exactly the shape of bug B603 found in
the photobook composer: a restore-then-persist pair of effects raced under the
double invocation and reliably wiped an arrangement on reload, every time,
under `next dev` — and never under `next build && next start`, where effects
run once. That direction cuts both ways. Before reporting a persistence- or
effect-ordering-shaped finding as a real user-facing bug, cross-check it
against a production build on the same port (`npm run build && npm run
start`); and before trusting a "looks fine" from `next dev`, remember that the
same double invocation is what would have caught this one, had anybody run the
composer in a browser sooner.
