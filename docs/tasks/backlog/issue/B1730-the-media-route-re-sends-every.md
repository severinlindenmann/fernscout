---
id: B1730
title: The media route re-sends every photograph hourly and reads each file whole into memory
type: ISSUE
priority: medium
complexity: low
area: media serving, caching
found: "2026-09-14T11:33:49Z"
---

# B1730 — The media route re-sends every photograph hourly and reads each file whole into memory

## Why

Two faults on one response path, `app/[user]/media/[...path]/route.ts`. They
share a file and a commit, so they share a ticket.

**No validator, so no request can ever be answered cheaply.** The route sets
`Cache-Control: public, max-age=3600, stale-while-revalidate=86400` on a
published photograph and no `ETag`, no `Last-Modified`. A browser with a
fresh copy in its cache has nothing to send back, so once the hour is up
every photograph on the page is re-fetched in full, and a reload with an
empty cache header (Cmd-Shift-R, a service worker revalidating, a proxy
holding a stale entry) re-downloads the whole gallery whatever its age. The
`stale-while-revalidate` window is worse than useless without one: the
background revalidation it promises cannot be a 304, so every stale hit is a
second full transfer.

The awkward part is that the bytes really are effectively immutable — ingest
gives a changed photograph a new filename rather than overwriting — but not
*provably* so from the URL, which is why `max-age` was left short in the
first place and why `immutable` would be a lie. A validator is the honest
version of the same optimisation: the long age becomes safe because a cache
that guesses wrong is corrected by a 304 rather than by serving a stale
photograph.

The identity this needs is already computed. `resizedCopy` in `lib/media.ts`
keys its disk cache on `sha256(file:mtimeMs:size:width)` and throws the
string away; that is exactly a strong ETag for the resized response, and the
same three facts describe an unresized one.

**And every 200 is buffered whole.** `route.ts` ends in
`new Response(new Uint8Array(fs.readFileSync(file)))`. For a photograph that
is a few hundred KB and nobody notices. For a clip it is the file: `media/`
takes video (`contentTypeFor` maps `.mp4`, `.webm`, `.mov`, and B669 added
range support precisely because clips are served here), the upload ceiling is
512 MiB, and a client that asks without a `Range` header — a `<video>`
preload in a browser that does not range-request, `curl`, a crawler — makes
this server allocate the entire file in RSS before a byte goes out. On a VPS
sized for a journal that is the difference between a slow response and an
OOM, and it needs only one request to do it.

## Work

Both changes are inside `app/[user]/media/[...path]/route.ts`, plus a small
export from `lib/media.ts`.

**A strong `ETag` on every media response, and `304` on a matching
`If-None-Match`.** Derive it from the same three facts `resizedCopy` already
hashes — path, mtime, size — plus the width actually served, so the resized
and unresized answers for one file never collide. Export the hashing from
`lib/media.ts` rather than writing a second one here: the resize cache key
and the ETag going out of step would mean a cache hit served under a
validator describing different bytes.

Once a validator is in place the freshness lifetime on a *published*
photograph can go up — a day, with a long `stale-while-revalidate` behind it.
A draft's or a labelled photograph's `private, no-store` does not change and
must not: the ETag goes on those responses too (it is correct, and a private
cache may still use it), but nothing about their cacheability moves.

Order matters. The 304 is returned *after* the three permission gates, never
before — a validator match is not a reason to skip asking whether this reader
may have the file, and answering 304 to somebody who should get a 404 would
confirm the photograph exists.

**Stream the unresized 200** with `Readable.toWeb(fs.createReadStream(file))`
instead of `readFileSync`. The `206` slice and the resized buffer stay as
they are: both are already bounded — a range is at most what the client asked
for, and a resized copy is a small WebP this route just made.

Not doing, deliberately: no AVIF, no prewarming derivatives at ingest, no
cache layer in front of the app, no object storage. The disk cache and the
allow-listed width set already work; those are separate tickets if the
numbers ever justify them.

## Acceptance

- A second request for a published photograph carrying `If-None-Match` from
  the first is answered `304` with no body, at a width and without one.
- A photograph whose file is replaced in place (new mtime, new size) gets a
  different `ETag` and is re-sent rather than revalidated.
- A draft photograph and a labelled photograph still answer `404` to a reader
  who may not have them — with an `If-None-Match` header present as much as
  without — and still carry `private, no-store`.
- A range request still answers `206` with the right `Content-Range`; an
  unsatisfiable one still answers `416`.
- Serving a large file does not hold it in memory: the unresized 200 body is
  a stream.
- `npm run verify` passes. A day page with a gallery renders at desktop and
  phone width with no broken images and no console errors.
