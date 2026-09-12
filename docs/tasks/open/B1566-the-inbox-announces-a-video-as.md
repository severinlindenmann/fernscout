---
id: B1566
title: The inbox announces a video as a photograph
type: ISSUE
priority: low
complexity: low
area: inbox, helper
found: "2026-09-12T07:31:55Z"
---

# B1566 — The inbox announces a video as a photograph

## Why

Live session `893fc9b4…` (journal `severin`, 2026-09-12, 06:57): the inbox
listing read `44f9ac6b-….mov — photograph, 2 MB`. A `.mov` is a video, and
calling it a photograph invites the owner to attach it where a still
belongs and misleads the model about what it is handling. The label is
rendered by the inbox listing block (`lib/helper/tools/areas/files.ts` /
`lib/inbox.ts` — whichever maps kind → word).

## Work

Where the inbox listing derives the human word from the stored kind, tell
video apart from photograph by extension/content type and say "video" in
all three locales. Nothing else — the stored `kind: media` stays as it is.

## Acceptance

An inbox holding a `.mov`/`.mp4` lists it as a video (en/de/hu), a `.jpg`
still as a photograph. A test on the listing block. `npm run verify` green.
