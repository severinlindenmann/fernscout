---
id: B1182
title: A phone with nothing uploaded yet has no way to upload anything
type: ISSUE
priority: high
complexity: low
area: helper room
found: "2026-09-09T20:33:07Z"
started: "2026-09-09T20:33:20Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T20:33:20Z"
---

# B1182 — A phone with nothing uploaded yet has no way to upload anything

## Why

Below `lg` the files pane opens only from the thumbnail strip above the
composer (`FilesStrip`, HelperRoom.tsx), and the strip renders only when
there is already at least one file. A journal whose inbox is empty and
whose newest trip has no photographs — every new journal, and every phone
before the first upload — has no entry point to the pane and therefore no
way to upload at all. The desktop rail is `hidden lg:flex`. Found while
walking persona M6 (Margrit uploading her first photos from an iPad).

## Work

A paperclip icon button in the composer, phone-widths only (`lg:hidden`),
always present, opening the same files `Sheet` the strip opens. The strip
keeps its thumbnails-when-there-are-files behaviour.

## Acceptance

At 390px on a journal with an empty inbox and a photo-less trip, the files
pane is reachable and a photo can be uploaded from it.
