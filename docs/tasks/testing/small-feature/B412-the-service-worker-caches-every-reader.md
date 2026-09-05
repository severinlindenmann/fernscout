---
id: B412
title: The service worker caches every reader into one shared bucket, so a signed-in home view cannot be cached at all
type: FEATURE
priority: medium
complexity: medium
area: pwa, service worker, cache
found: "2026-09-05"
related: B410, B411, B330
started: "2026-09-05T09:02:06Z"
merged: "2026-09-05T09:07:25Z"
---

# B412 — The service worker caches every reader into one shared bucket, so a signed-in home view cannot be cached at all

## Why

`public/sw.js` keeps everything in two caches, `shell-v4` and `runtime-v4`,
keyed by URL and by nothing else. It has no notion of who asked. Navigations are
cached network-first and `.json` stale-while-revalidate, both into `runtime`.

That is already the subject of B330 for `story.json`, which varies by cookie and
does not say so. B411's home view makes it sharper: a URL whose whole content is
*the list of private journals this person may open*. Cached the way the worker
caches things today, the next person to open the PWA on a shared phone is served
the previous reader's list.

So the honest position today is that the signed-in home view cannot be cached at
all — which is the opposite of what a PWA is for. Opening it on a bus would show
the offline page rather than a list of journal names that has not changed in a
month.

## Work

Split private from shared rather than making the shared cache smarter.

- `/` is a **shell**: markup, the public journal list, no personal data. Stays
  cacheable as it is today.
- The personal half arrives from B411's `GET /api/v1/me/home` and is kept in
  `personal-<id>`, where `<id>` is the **opaque public identity id** from
  B410's migration, returned in the response body. Not the token: `fs_identity`
  is httpOnly and a service worker cannot read it, which is the correct state
  and must stay that way.
- The current id is mirrored into IndexedDB so a **cold offline open** knows
  which `personal-*` cache to serve. Without it the worker has no response to
  read the id from and would have to guess.
- Sign-out purges every `personal-*` cache; so does a `401` from the endpoint.
- `SHELL` and `RUNTIME` bump to `v5`.

The exemption for `/api/` in the fetch handler has to gain exactly one hole,
and it should be written as a named allowlist rather than a loosened prefix
test — everything else under `/api/` must keep going straight to the network.

**Not** in this task: prefetching journal pages for offline reading. That would
put private content in the shared `runtime` cache and force it to be
identity-keyed too, which is a much larger change and a separate argument.

**Known limit, to be written into the worker's own comment rather than
discovered later:** a device that is offline still shows its cached journal
*list* after the identity is revoked elsewhere, until it next reaches the
network. Names only, no content. Fixing it needs a server round trip, which is
the thing being unavailable.

## Acceptance

- Two identities on one browser profile, in sequence: the second never sees the
  first's list, offline or online.
- Sign out, go offline, open the PWA: the public landing page, not a cached
  personal list.
- A cold offline open of an installed PWA shows the last known journal list.
- Every `/api/` path except the one allowlisted endpoint is still uncached, and
  a test asserts the allowlist rather than the prefix.
- `test/service-worker.test.ts` covers the purge on sign-out and on 401.
