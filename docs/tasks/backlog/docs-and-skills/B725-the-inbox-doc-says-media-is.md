---
id: B725
title: The inbox doc says media is the only kind a media route files
type: DOCS
priority: low
complexity: low
area: inbox
found: "2026-09-07T11:44:13Z"
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
