---
id: B725
title: The inbox doc says media is the only kind a media route files
type: DOCS
priority: low
complexity: low
area: inbox
found: "2026-09-07T11:44:13Z"
started: "2026-09-07T12:55:00Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:55:00Z"
---

# B725 — The inbox doc says media is the only kind a media route files

## Why

`lib/inbox.ts:64` — the `INBOX_KINDS` doc says `media` "is the only kind the
media route will file". Since B683 the helper's media route also files `files`,
for anything that is not a photograph or a video.

The sentence is still true of `POST /api/v1/<user>/inbox`, which is what it was
written about, but it now reads as a claim about every media route and is not.

## Acceptance

The comment says which route it is about.

## Work done

`lib/inbox.ts:60-64` — the `INBOX_KINDS` doc now says `media` is the only kind
`POST /api/v1/<user>/inbox` will file, and notes that the helper's own media
route is a separate door that also files `files`, for anything that is not a
photograph or a video (B683). Pure prose; no code behaviour changed. Covered
by the suite passing (`npm run verify`) — no dedicated test, per this
ticket's own acceptance and the DOCS-type convention.
