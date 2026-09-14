---
id: B1729
title: Caddy rewrites the ETag when it compresses, so no client that accepts gzip can ever send a matching If-Match
type: ISSUE
priority: high
complexity: low
area: deploy, api v2
found: "2026-09-14T11:18:56Z"
started: "2026-09-14T11:33:11Z"
session: 3309c078-d934-4ee7-ad04-6cd719fc543a
claimed: "2026-09-14T11:33:11Z"
---

# B1729 — Caddy rewrites the ETag when it compresses, so no client that accepts gzip can ever send a matching If-Match

## Why

Found while porting fernscout-helper to v2 (B1715), by the first client that
tried to do the ordinary thing: read a document, then write it back with
`If-Match`.

```
$ curl -sD- .../days/2025-11-14-tram-28-both-ways            # no accept-encoding
etag: "f16ecbb22fc33f4cd0dfd75310633eb2"

$ curl -sD- ... -H 'accept-encoding: gzip'                   # what every client sends
content-encoding: gzip
etag: "f16ecbb22fc33f4cd0dfd75310633eb2-gzip"
```

Caddy's `encode` appends `-gzip` to the ETag of anything it compresses. That is
correct for `If-None-Match` — the compressed body genuinely is a different
representation — and it is fatal for `If-Match`, because the value a client
reads back is not the value the origin will compare against. `fetch` sends
`accept-encoding: gzip` by default, so:

- `GET` a day → `"…-gzip"`;
- `PATCH` it with that as `If-Match` → **409 `stale_document`**, every time,
  on a document nobody else has touched.

The refusal is the worst possible one to debug: its message says the document
"has moved on … it changed since you last read it", which is a confident
statement about somebody else's write that never happened. The helper's
validator hit this on six consecutive days of the demo journal and reported
each as a conflict.

**Every conditional write in v2 is affected**, because v2 made `If-Match` the
way a caller replaces anything: `PUT` is create-only, so a deliberate replace
of a trip, a day or a figure needs the header, and that is exactly the header
that cannot be satisfied. The only clients not hitting it are the ones that
send no `accept-encoding`, i.e. hand-written `curl`.

## Work

- Stop the ETag being rewritten on the responses where it is load-bearing —
  the `/api/v2/**` document routes. Either exclude them from `encode`, or
  strip/normalise the suffix before the comparison in `ifMatchStale`
  (`lib/api/v2/route.ts`), which is the one place the header is read.
- Whichever is chosen, a test that a `GET` then a `PATCH` with the ETag the
  `GET` returned succeeds **with `accept-encoding: gzip` set**, because
  without that header the bug is invisible.
- Check `If-None-Match` still behaves: the suffix exists for a reason, and a
  fix that strips it everywhere would make a compressed and an uncompressed
  body share a validator.

## Acceptance

- A client that accepts gzip can read a day and write it back with `If-Match`
  and get a 200, against the live instance.
- A `409 stale_document` means the document actually moved.

## Meanwhile

fernscout-helper strips a trailing `-gzip` from the ETag before sending it
back (`shared/api.mjs`), so the port is not blocked. That workaround comes out
when this lands.

---

## Revalidated, 2026-09-14 — valid, and measured rather than argued

```
$ curl -sD- .../days/2025-11-14-tram-28-both-ways            # no accept-encoding
etag: "f16ecbb22fc33f4cd0dfd75310633eb2"
$ curl -sD- ... -H 'accept-encoding: gzip'
etag: "f16ecbb22fc33f4cd0dfd75310633eb2-gzip"
```

`deploy/fernscout.caddy:29` is `encode gzip zstd`, and that is where the suffix
comes from.

## Done, 2026-09-14

Fixed in `ifMatchStale` (lib/api/v2/route.ts) rather than in the Caddyfile, for
two reasons that both point the same way:

- **Suffix-appending is correct for `If-None-Match` and wrong for
  `If-Match`.** A gzipped body genuinely is a different representation and a
  cache validator must tell them apart; `If-Match` on a write asks about the
  state of the *resource*, which no content coding changes. So the place to
  undo it is the write path, not the proxy.
- Excluding `/api/v2/**` from `encode` would fix this instance and nothing
  else. Any proxy that relabels a compressed ETag — and several do — breaks
  every client the same way. This holds for all of them.

`withoutProxyEncoding` strips a trailing `-gzip`/`-br`/`-zstd`/`-deflate`/
`-compress` from the **incoming** tag only, and the unmodified tag is still
tried first, so the change can only accept a header that was previously
refused. Every ETag this server issues is a quoted hex hash (`etagFor`), so
none can end in one of those names and lose a character to it.

Five cases in `test/api-v2-route.test.ts`: each of the four codings matches the
document it names, and a genuinely different document is still stale with a
suffix on it.

**Still to check after the deploy:** a real `GET` then `PATCH` with
`accept-encoding: gzip` against fernscout.ch. Without that header the bug is
invisible, which is how it survived this long.

Once that passes, fernscout-helper's workaround in `shared/api.mjs`
(`etagOf`) comes out — it is marked as a workaround and names this ticket.
