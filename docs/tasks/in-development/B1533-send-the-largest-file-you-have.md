---
id: B1533
title: "\"Send the largest file you have\" is true, load-bearing, and buried where no uploader reads it"
type: DOCS
priority: medium
complexity: low
area: docs, media, photobook
found: "2026-09-11T21:20:00Z"
started: "2026-09-11T20:56:33Z"
session: bfe90fb0-0095-4532-8af8-601ad489b14c
claimed: "2026-09-11T20:56:33Z"
---

# B1533 — "Send the largest file you have" is true, load-bearing, and buried where no uploader reads it

## Why

Companion to B1529, which is the bug this documentation gap produced.

`skill/ingest-photos.md` says exactly the right thing:

> a resized copy at 2000px which is what the site serves … and the original,
> untouched, which is what a printed photobook is made from
>
> **Send the largest file you have**
>
> a full-page plate at 300 dpi wants about 2500×3500

Every word of that is correct and it is the only place it appears. It is not in
`agent.md`, not in `openapi.json`'s description of `POST …/media`, and not in
`content-model.json`. An agent that reads the API contract — which is the
documented way to work against an instance — learns that an image may be up to
**8000px and 50 MB** and learns nothing about why it would want to approach
that.

`/api/health` reinforces the wrong reading. It publishes `imageMaxEdge: 8000`
next to `imageMaxBytes` and `requestMaxBytes`, all of them ceilings, all of them
phrased as limits to stay under. Nothing in that document says the stored file
is the print master, so the obvious inference — "the site shows 2000px, send
2000px, be a good citizen about bandwidth" — is both reasonable and destructive.

`fernscout-helper` made precisely that inference and shipped it as a default for
however long: every journal published through it has a photobook printing from
web-sized files at roughly 170 dpi. Nobody noticed, because the site looks
correct — the site was only ever going to show 2000px — and the loss is visible
only in print, where it cannot be undone.

The documentation was right. It was in one file, and the file it needed to be in
was a different one.

## Work

Put the sentence where an uploader actually looks:

- **`POST …/media` in `openapi.json`.** One line in the description: what is
  sent is kept as the print master, the 2000px web copy is derived, send the
  largest you have. This is the document agents read.
- **`/api/health`.** `imageMaxEdge` reads as a limit. Give it a description
  saying the stored original is what a photobook prints from — a ceiling and a
  target are different things and the field currently only communicates one.
- **`agent.md`**, in the photographs section, with the 2500×3500 number. The
  concrete figure is what makes it actionable; "as large as possible" alone
  invites a judgement call and the judgement went wrong once already.

Also worth a line somewhere: **an already-uploaded photograph cannot be improved
in place.** `publish` matches by filename, so re-sending a larger file of the
same name is skipped silently; the only route is `DELETE …/trips/{trip}/media`
per day and upload again. An owner who discovers this after publishing a trip
has 177 deletions and 177 uploads ahead of them, and nothing tells them that
before they publish. Saying it up front is cheaper than saying it after.

## Acceptance

- An agent reading only `openapi.json` learns that the uploaded file is the
  print master and should be as large as it has.
- `/api/health`'s `imageMaxEdge` says what the number is for, not just what it
  forbids.
- The 300 dpi / 2500×3500 figure appears where somebody sizing an export will
  meet it.

## Done

Put the sentence in the three places it needed to be, plus the checkout's own
guide:

- **`lib/api/openapi.ts`**, `POST .../trips/{trip}/media`'s description: says
  outright that the sent file is kept untouched as the print master, that a
  photobook is made from it and never from the resized copy, the 300 dpi /
  2500×3500 figure, and points at `/api/health`'s `media.imageMaxEdge` as the
  ceiling to approach rather than stay comfortably under.
- **`/api/health`**: `lib/api/openapi.ts`'s schema for `media.imageMaxEdge`
  gained a `description` saying it is a ceiling *and* a target — the same
  words as the media route's own description, so the two do not drift.
  `app/api/health/route.ts`'s own code comment above the `media:` block
  explains why the sentence had to move here at all (B1533/B1529: a bare
  integer can't carry it, and `fernscout-helper` read its absence as licence
  to downsize before uploading).
- **`AGENTS.md`**, a new paragraph in the content-model section, right after
  the `content/<username>/` tree: the print-master framing, the 2500×3500
  figure, and the duplicate-name caveat below.

**The duplicate-name caveat, corrected from the ticket's wording.** The
ticket says "`publish`/the media route matches by filename and silently
skips a duplicate name" — checked against the actual code
(`lib/api/media.ts`, `lib/ingest/index.ts`) and that is not how *this
server's* dedup works: both `POST .../media`'s own skip and the local
`npm run ingest` ledger key on a SHA-256 of the bytes, not on the filename
(already documented correctly in the `201` response's `skipped` prose). The
filename-matching skip the ticket describes is `fernscout-helper`'s own
local publish tooling (see B1529, "the `--replace-media` problem"), which is
a different repository this checkout cannot change. What *is* true here, and
worth saying for the same reason — an owner discovering it after publishing
177 photographs — is the byte-based version of the same trap: re-sending a
bigger export of a photograph already on a day is not recognised as an
improvement (different bytes, not a duplicate) and lands as a second, separate
item rather than replacing the first, so the only way to swap one in is
`DELETE .../media` then re-upload. That is what `openapi.ts` and `AGENTS.md`
now say; `fernscout-helper`'s own filename-keyed behaviour is out of scope
here and stays B1529's to fix, in its own repository.

Verified: `npx vitest run test/openapi-contract.test.ts
test/api-route-schemas.test.ts test/health-content-writable.test.ts
test/video-absent.test.ts test/docs-links.test.ts` — 138 tests, all pass.
