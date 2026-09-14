---
id: B1730
title: The media route re-sends every photograph hourly and reads each file whole into memory
type: ISSUE
priority: medium
complexity: low
area: media serving, caching
found: "2026-09-14T11:33:49Z"
started: "2026-09-14T11:34:54Z"
merged: "2026-09-14T11:49:51Z"
completed: "2026-09-14T16:33:05Z"
---

# B1730 — The media route re-sends every photograph hourly and reads each file whole into memory

## Validity

**Valid**, read at 66c847f4. `app/[user]/media/[...path]/route.ts:196-216`
builds its header map with `Cache-Control`, `Vary`, `nosniff` and a CSP and no
validator of any kind; nothing in the file reads `If-None-Match`, and
`grep -rn "etag" lib app --include=*.ts -i` finds the header only in the v2
document routes. `route.ts:246` is the `fs.readFileSync` whole-file read.

Adjacent but not the same ticket: **B1729** is Caddy's `encode` appending
`-gzip` to an ETag, which breaks `If-Match` on `/api/v2/**`. That suffix is
*correct* for `If-None-Match` — Caddy compares against the value it handed
out — so it does not affect this route, which only ever does conditional
reads. Different file, different header, no overlap in the diff.

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

## What was built

Both halves, in `app/[user]/media/[...path]/route.ts` with one helper pair
exported from `lib/media.ts`. Three things the Work section did not know:

**The `304` sits above the resize, not just above the body.** The ticket
framed this as saving a transfer; it also saves the sharp call, because a
conditional request that matches is answered before `resizedCopy` is ever
asked for a derivative nobody is going to receive. That is the most expensive
thing this route does, and on a revalidating gallery it now happens zero
times instead of once per photograph.

**The `-gzip` suffix is deliberately not stripped.** B1729 is Caddy's
`encode` rewriting an ETag and breaking `If-Match`; the reflex is to be
tolerant of the suffix here too. That would be wrong: for a conditional
*read* the suffix is the one thing distinguishing a compressed
representation from an uncompressed one, and stripping it would let a cache
match across the two. It does not arise today — `encode` compresses text
types and leaves image and video bodies alone — and if it ever does, the fix
is excluding this path from `encode`, not loosening the comparison. Said in
full in the docblock on `validatorCovers`.

**The streaming assertion had to count chunks.** The obvious test —
`expect(res.body).toBeInstanceOf(ReadableStream)` — is green against the bug,
because `new Response(uint8Array)` exposes a stream body too. What a buffered
body cannot do is arrive in pieces, so `test/media-validator.test.ts` reads
a 256 KiB clip and asserts more than one chunk. Six of its ten tests fail
against the pre-branch route and all ten pass after; the other four are the
gate and range checks, which are there to prove the early exit did not climb
above the permission checks and were expected to pass either way.

Published freshness went from `max-age=3600, stale-while-revalidate=86400` to
`max-age=86400, stale-while-revalidate=604800`. Not `immutable`: the URL
carries no content hash, and a file replaced in place under the same name is
something a person can do with `scp`.

## Security review

Read against the branch diff rather than fanned out to agents: the change is
two source files and about eighty lines, and the whole question it raises is
one of ordering.

The risk an early exit on this route introduces is a `304` reaching somebody
who should get a `404` — a validator match confirming a photograph exists to
a reader the gates would refuse. It does not: the three gates and
`resolveMediaFile` return at lines 169, 188, 208 and 213, and the conditional
exit is at 263. A refusal carries no `ETag` at all, so there is nothing for a
stranger to replay. `test/media-validator.test.ts` takes a tag as a reader who
may have the file, closes the trip, replays it, and asserts `404` with no
validator on the refusal.

The other three, briefly. The tag is a truncated sha256 of an absolute path,
mtime, size and width — a hash, and only ever handed to somebody already
receiving the bytes, who knows the size from `Content-Length` anyway.
`If-None-Match: *` is a `304` for any reader who already passed the gates,
which is what the bytes would have been. And a `no-store` response carries a
tag now, which is correct of it and reaches nobody who could not already read
the file.

One thing changed as a result: the `304` now repeats `Content-Security-Policy`
and `X-Content-Type-Options`. A cache is required to keep the stored `200`'s
fields and update only what the `304` repeats, so this is belt to existing
braces — but this file already declares the media CSP twice on purpose, and a
response standing in for one that carries it should carry it too.
