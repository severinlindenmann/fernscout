---
id: B1320
title: The desktop preview column is open while empty; it should close until something arrives
type: ISSUE
priority: high
complexity: low
area: helper room
found: "2026-09-10T15:42:57Z"
started: "2026-09-10T15:43:10Z"
merged: "2026-09-10T16:11:56Z"
---

# B1320 — The desktop preview column is open while empty; it should close until something arrives

## Why

The desktop preview column ("Vorschau") was open on arrival even when there
was nothing to preview — an empty pane taking a third of the screen. The
owner asked for closed-by-default, opening only when the preview has content
(2026-09-10). Supersedes the D24-B remembered-width behaviour where the two
conflict.

## Work

`HelperRoom.tsx`: `previewCollapsed` starts `true`; a `manuallyClosed` ref
records a deliberate close; the preview-content effect auto-opens only when
the person has not just closed it; pressing a day chip always opens. The
localStorage width memory for the collapsed state was removed. Three tests in
`test/helper-room.test.tsx` rewritten (closed on arrival, no `/day?` fetch
while closed, chip opens it).

## Acceptance

On desktop the room arrives with the preview closed and no request for the
day; once a turn produces a preview, the column opens itself; closing it by
hand keeps it closed for the rest of the visit. Checked in Playwright on
2026-09-10.
