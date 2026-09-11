---
id: B1493
title: The landing page lists no journals for a reader holding only a journal cookie
type: ISSUE
priority: medium
complexity: low
area: auth, home
found: "2026-09-11T17:16:54Z"
---

# B1493 — The landing page lists no journals for a reader holding only a journal cookie

## Why

Found while building B1492, which is the same hole one door along. `/`'s
"your journals" list is drawn from `/api/v1/me/home`, which asks
`resolveIdentity()` — the instance-wide `fs_identity` and nothing else. A
browser signed into a journal but holding no identity (one that predates B410,
or whose identity has been cleared) is told it has no journals, on the page
whose whole job is to say which journals it has.

B459's `POST /api/auth/identity/upgrade` would mint one, but the component that
calls it, `components/IdentityUpgrade.tsx`, is mounted only by
`app/[user]/layout.tsx:161`. B1492 mounts it on `/agent` as well; `/` is
deliberately left out of that ticket because the obvious fix there — the root
layout — would force every public page including the landing page to render
dynamically.

## Work

Decide where the upgrade can be triggered for `/` without making the landing
page dynamic. The likely answer is client-side, from whatever already fetches
`/api/v1/me/home`: an empty answer is exactly the moment to try the upgrade
once and re-fetch, and that component only mounts where the list is drawn.

Not: a root layout mount; not: loosening `resolveIdentity` (see
`lib/auth/handshake.ts:99-107`).

## Acceptance

Sign in as an owner locally, delete `fs_identity`, and open `/`: the journal
is listed. The landing page still renders statically for a signed-out
stranger.
