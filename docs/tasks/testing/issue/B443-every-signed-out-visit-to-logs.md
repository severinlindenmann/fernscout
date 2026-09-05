---
id: B443
title: Every signed-out visit to / logs a 401 in the browser console
type: ISSUE
priority: low
complexity: low
area: home, service worker
found: "2026-09-05T12:24:48Z"
merged: "2026-09-05T12:28:32Z"
---

# B443 — Every signed-out visit to / logs a 401 in the browser console

## Why

`components/Landing.tsx:112` fetches `/api/v1/me/home` on every load of `/`, and
`app/api/v1/me/home/route.ts:33` answers a stranger `401`. Chrome prints a
failed fetch to the console whatever the page does with it, so every
signed-out visit — which is most of them — leaves a red
`GET /api/v1/me/home 401 (Unauthorized)` behind. Reported from fernscout.ch.

Nothing is broken: the page handles it and shows the landing view. The cost is
that the console the author reads for real faults is never clean, which is the
same argument `unavailable()` in `public/sw.js` already makes about 503s.

The page cannot skip the fetch instead. `fs_identity` is httpOnly, `/` is
deliberately impersonal so B412 can cache it for everybody, and the
`fs-home-signed-in` localStorage flag is a hint rather than an answer — a
reader who signed in on `/alice` has no flag on `/`.

So the endpoint should answer "nobody is signed in" as data rather than as an
error status. It is an identity probe, not a protected resource: there is no
credential to retry with and nothing to withhold.

## Work

- `app/api/v1/me/home/route.ts`: answer `200` with `{ id: null, journals: [],
  devices: [] }` for a stranger and for the capability being off, instead of
  `401`/`404`. Same `private, no-store` header.
- `components/Landing.tsx`: decide on `data.id` rather than `res.ok`.
- `public/sw.js`: `rememberPersonal` purges when the body carries no id, so a
  revoked identity still drops the cached copy now that the refusal is a `200`.
  Leave the existing 401/404 purge in place — an older worker outlives a
  deploy, and other statuses still mean the same thing.

Not doing: the `401` on `/api/v1/me/devices/[id]` — that one is a real
protected route an agent can call wrongly, and nothing fetches it
speculatively.

## Acceptance

- `curl -si https://fernscout.ch/api/v1/me/home` with no cookie → `200` and
  `{"id":null,…}`.
- Loading `/` signed out leaves no error in the browser console.
- `test/service-worker.test.ts` still shows a revoked identity losing its
  cached copy, now via a `200` with no id.
