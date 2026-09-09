---
id: B1042
title: The service worker caches owner-only responses forever and ignores no-store
type: ISSUE
priority: high
complexity: low
area: public/sw.js, app/[user]/trips/[trip]/day/[slug]/notify/route.ts
found: "2026-09-09T08:20:00Z"
started: "2026-09-09T04:59:30Z"
merged: "2026-09-09T05:16:12Z"
---

# B1042 — The service worker caches owner-only responses forever and ignores no-store

## Why

Reported as "why do I see *Zusammen 1* and not the list we discussed?" — a
send confirmation showing B1024's new sentences with **no channel rows at all**
and a total that cannot exist without one.

It is not the panel. The browser was running B1024's JavaScript against a
**cached copy of the old server response**: `pending: ["mail","whatsapp"]`,
plain strings from before the deploy. The new panel filters on `count > 0`,
`undefined > 0` is false, every row was dropped — and `needed: 1` from the same
stale payload still drew the total. New client, old data, and the two disagree
exactly where the screenshot does.

Two faults behind it, and the second is the one that matters.

**The route sends no cache header.** Every other owner-only response under
`app/[user]/` says `private, no-store` (`photobooks/[id]/[file]`,
`delete/[token]/export.zip`, `export.zip` for a whole journal) or at least
`private` (`story.json`, `search-index.json`). `notify/route.ts` says nothing.

**The service worker would have cached it anyway.** `public/sw.js:345` skips
anything under `/api/`, with the comment *"Reaction counts, auth and anything
that writes must never come from a cache"* — and this route deliberately lives
outside `/api/`, because B633 made it the owner's own cookie door rather than
an agent endpoint. So it falls past every branch to the final catch-all, which
is **cache-first, forever**, meant for build assets and photographs.
`putRuntime` stores any same-origin `ok`, `basic` response and never reads
`Cache-Control` at all — so `private, no-store` on the route alone would not
have saved it, and `story.json`'s `private, max-age=60` is likewise cached
past its own max-age by the `.json` branch above.

That makes it more than a stale screen. The cached payload carries the
journal's **credit balance**, written into the shared `runtime-v5` cache, which
`purgePersonal()` does not touch on sign-out — the whole reason `PERSONAL_PATH`
exists is to keep the one authenticated response apart, and this one walked
past that arrangement by not being under `/api/`.

Not caused by B1024. B1024 is what made it visible: the old and new shapes of
`pending` were compatible enough that a stale copy had never produced a wrong
screen before.

## Work

- **`putRuntime` reads `Cache-Control`** and stores nothing that says
  `no-store` or `private`. That is the general fix: it covers this route, the
  two `.json` routes above, and every owner-only route somebody adds later
  without thinking about the worker.
- **The notify route says `private, no-store`**, joining the convention the
  rest of `app/[user]/` already follows.
- **Bump `VERSION`.** Existing browsers hold the bad entry in `runtime-v5`;
  activation deletes every cache not ending in the current version, so this is
  what actually clears the screen somebody is looking at now.

Not doing: rewriting the catch-all to an allow-list of asset paths. It is the
more thorough answer and a bigger change; respecting the header the server
already sends fixes the reported fault and the class it belongs to.

## What was done, and the trap in testing it

`mayCache()` in `public/sw.js` reads `Cache-Control` and refuses to store
anything saying `no-store` or `private`; the notify route now sends
`private, no-store`; `VERSION` is `v6`, which is what deletes the entries an
installed worker is already holding.

**The first version of the test passed for the wrong reason**, and it is worth
recording because the shape recurs. `putRuntime` keeps only responses with
`type: "basic"`, and a `Response` built in Node has `type: "default"` — so
nothing was written to the fake cache at all, and both "refuses to keep this"
assertions were green against a worker with the fix removed. The positive
control in the same block ("keeps an ordinary public response") is what caught
it; the fake now hands back an object that says `basic`, and removing
`mayCache` fails exactly the two tests it should.

## Acceptance

- With the worker installed and a day already visited, a deploy that changes
  the notify response shows the new response on the next open, not the old one.
- `curl -sI` on the notify route shows `private, no-store`.
- Nothing under a `no-store` or `private` header appears in `caches` after a
  page visit — checked in DevTools, Application → Cache Storage.
- `story.json` and `search-index.json` are no longer written to the runtime
  cache.
- `npm run verify` clean.
