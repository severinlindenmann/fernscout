---
id: B1551
title: Any route buffers 512 MiB in memory before auth runs; Caddy sets no request_body max_size
type: SECURITY
priority: high
complexity: low
area: deploy/edge
found: "2026-09-11T23:06:54Z"
started: "2026-09-12T07:22:47Z"
merged: "2026-09-12T08:16:06Z"
---

# B1551 — Any route buffers 512 MiB in memory before auth runs; Caddy sets no request_body max_size

## Why

`lib/validate/media.ts:106` sets `REQUEST_MAX_BYTES = 512 MiB` and
`next.config.ts:106` applies it instance-wide via
`experimental.proxyClientMaxBodySize`. Next buffers the whole body in memory
before the route handler — and therefore before `authenticate()` — runs; the
file's own comment at `media.ts:94-99` says so. Neither `deploy/Caddyfile` nor
`deploy/fernscout.caddy` carries a `request_body max_size`, so an
unauthenticated caller can hold 512 MiB of RAM per connection: twenty parallel
POSTs are ~10 GB of memory commitment plus full ingress bandwidth before a
single 401 is produced. On the VPS that is an OOM kill. The `Content-Length`
pre-check in the media route runs after buffering and chunked transfer has no
Content-Length at all.

## Work

- Add `request_body { max_size … }` stanzas to the Caddyfile, sized per path:
  large only on the upload/import routes, small (a few MB) everywhere else.
- Deploy config change plus a note in `docs/` — no application code expected.
- Not doing: streaming request handling in Next; the edge limit is the fix.

## Acceptance

Against a deployed (or locally Caddy-fronted) instance, an unauthenticated
512 MB POST to a non-upload route is refused by Caddy with 413 without the Node
process's memory moving; a legitimate media upload within the documented limits
still succeeds.
