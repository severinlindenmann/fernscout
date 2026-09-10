---
id: B1335
title: sharp is bundled rather than external, so ordering a book 500s on the server
type: ISSUE
priority: high
complexity: low
area: photobook, build
found: "2026-09-10T17:40:00Z"
---

# B1335 — sharp is bundled rather than external, so ordering a book 500s on the server

## Why

Pressing the order button on the live instance answered **500**:

```
Failed to load external module sharp-20c6a5da84e2135f:
  Cannot find package 'sharp-20c6a5da84e2135f'
  imported from /srv/fernscout/.next/server/chunks/[turbopack]_runtime.js
```

`sharp` is a native binding. `next.config.ts` names `better-sqlite3` and `pg`
in `serverExternalPackages` and stopped there, so Turbopack tried to carry
`sharp` into the bundle and produced a hashed external the runtime cannot
resolve.

Three modules import it — `lib/api/media.ts`, `lib/ingest/image.ts` and, since
B1172, `lib/photobook/images.ts`, which re-encodes every photograph in a book
to print resolution. The photobook path is the one that reached a person: an
order that had worked an hour earlier began failing after a routine rebuild.

Why it surfaced only now: this is build-shaped, not code-shaped. It depends on
what Turbopack decided to externalise on a given build, so it appeared after a
rebuild rather than after a commit — the same class of thing as B1311's
outage, and just as invisible in review.

## Work

Add `sharp` to `serverExternalPackages`. It is what the comment beside that
list already claims the list is for.

## Acceptance

- Ordering a photobook on the live instance does not 500.
- `npm run verify`, and a build on the server.
