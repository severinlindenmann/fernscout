---
id: B1575
title: The Dateien tab's upload control sits below every file, out of reach on a long list
type: ISSUE
priority: low
complexity: low
area: agent room, mobile
found: "2026-09-12T08:54:29Z"
started: "2026-09-12T09:17:43Z"
session: 5a4744c4-0424-4149-9d23-d8a0bd9dd3b1
claimed: "2026-09-12T09:17:43Z"
---

# B1575 — The Dateien tab's upload control sits below every file, out of reach on a long list

## Why

Reported directly: the "Dateien" tab's upload control must be at the top,
not the bottom — with several files already uploaded, a person has to scroll
past all of them to find it.

`components/HelperRoom.tsx:2506`, inside `FilesPane`, renders `<UploadPanel
… />` as the very last element — after the selection count/clear row, the
inbox groups (`InboxFileGroups`, potentially many rows), and the trip photos
`Group`. On a phone, with a long inbox, the upload control is scrolled well
below the fold every time the tab opens.

## Work

- `components/HelperRoom.tsx` — move `<UploadPanel username={username}
  onInboxAdded={onInboxAdded} />` (line 2506) to render before the inbox
  groups and trip-photos group, immediately after the selection-count row
  (around line 2415), so it is visible without scrolling regardless of how
  many files are already listed.
- No change to `UploadPanel` itself, or to what it does — this is a render
  order change only.

## Acceptance

- On a phone-width browser with several inbox files already present, open
  "Dateien": the upload control is visible without scrolling.
- `npm run verify` passes.
