---
id: B549
title: Warnings name codes and source symbols instead of saying what it means
type: FEATURE
priority: high
complexity: medium
area: photobook, composer, ux
found: "2026-09-06T09:04:24Z"
merged: "2026-09-06T09:38:43Z"
completed: "2026-09-07T13:11:52Z"
---

# B549 — Warnings name codes and source symbols instead of saying what it means

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

See B547. On the demo trip the warnings block is **physically larger than the
book preview**, and it reads like this:

- **`no-original`** — as a heading. Then: "14 of 14 photographs printed from the
  web copy because no original was kept for it:
  `example/trips/usa-2026/media/denver-and-a-truck/01.jpg`,
  `…/02.jpg`, `…/03.jpg`, …. The web copy is capped at 2000px, which is soft on
  a full page."
- **`blank-padding`** — "Volume 1 ends with 6 blank pages: there was not enough
  content to reach the 32-page minimum even after spreading the photographs out.
  A trip this short wants saddle stitch (4-48 pages) rather than perfect binding
  — **see `SADDLE_STITCH` in `lib/photobook/spec.ts`**."
- **`14 × low-resolution`**

Three problems, in increasing order of seriousness. The codes are internal
identifiers with no meaning to a reader. The media paths are our directory
layout. And the third is a **source-code symbol and a repository path shown to
a paying customer** — nobody outside this repository can act on it, and it tells
them they are using unfinished software.

The `blank-padding` text also states the remedy outright and then declines to
apply it. The software knows this trip wants saddle stitch. It should offer the
change, not describe it.

## Work

A warning becomes **a consequence in plain words, and where possible a remedy
with a button**.

`BookWarning` already carries `code` and `detail`, and since B517 an optional
`date`. Keep the code — it is the right thing for a machine to key on — and stop
rendering it. The `detail` string is where the internal information leaks; treat
it as a developer's note and give the reader their own sentence instead, in
`lib/photobook/strings.ts` with the rest of the book's vocabulary, in all three
languages.

Two the software can act on, and therefore should offer rather than explain:

- `blank-padding` on a short trip → offer the binding it already knows is right.
- `low-resolution` / `no-original` → the honest remedy is a smaller format, and
  the planner can say which one clears it.

Never show: a `code` as a heading, a path under `content/`, a symbol from
`lib/`, or a filename the reader did not choose. A count and a plain
consequence is enough; keep the specifics behind a disclosure for somebody who
asks.

**Not doing:** removing warnings. A book that will print badly must still say
so — this is about saying it usefully. Nor the `detail` field itself; it stays
for logs and tests.

## Acceptance

- No `code`, path under `content/`, or symbol from `lib/` renders in the
  composer.
- A short trip is *offered* the binding that fixes its blank pages, and one tap
  applies it.
- A book with nothing wrong shows no warnings block at all.
