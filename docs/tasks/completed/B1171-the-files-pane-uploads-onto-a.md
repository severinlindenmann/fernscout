---
id: B1171
title: The files pane uploads onto a day nobody chose and never shows the result
type: ISSUE
priority: high
complexity: medium
area: helper room
found: "2026-09-09T20:04:48Z"
started: "2026-09-09T20:06:22Z"
merged: "2026-09-09T20:26:54Z"
---

# B1171 — The files pane uploads onto a day nobody chose and never shows the result

## Why

The files pane's upload writes photographs onto whatever day is the
current preview subject (`UploadPanel`, `HelperRoom.tsx:1330`, POSTing
`/api/helper/<user>/day/media`) — on a fresh visit that is an old draft the
person never chose. Reproduced: two photos answered 201 onto
`japan-2027/hakodate-before-sapporo` while the pane continued to say
"Nothing is waiting, and this trip has no photographs yet" — `files` is a
server-render prop nothing refreshes. Nothing a person uploads ever reaches
the inbox, though the pane's own copy promises "a bank statement …waits
under What is waiting" and the inbox is the designed home for files that
belong to no day yet (B663). With no subject there is no upload control at
all.

## Work

- New `POST /api/helper/<user>/inbox` (cookie-gated like every helper
  route) wrapping `lib/inbox.ts`'s store — multipart, same size/format
  limits as the v1 inbox route.
- `UploadPanel` uploads to the inbox always; the pane's local `inbox` state
  gains the stored files immediately (the route answers with the stored
  descriptors). Copy updated in en/de/hu to say where files land and what
  to say next ("put these on Friday").
- Day-targeted upload (the old behaviour) survives only inside the preview
  pane, labelled with the day it lands on.
- Keep `uploadQueue` for the day path; the inbox path is a plain multipart
  POST (inbox files need no web-derivative phase).
- Not doing: drag-and-drop; a per-file progress UI beyond the existing
  status line.

## Acceptance

- Uploading a photo from the pane with no day named lands it in
  `content/<user>/inbox/media/` and its tile appears without a reload.
- Uploading with a day named still lands in the inbox (the preview's own
  upload is the day path), and saying "put these on <day>" moves it.
- The pane never claims nothing is waiting while a file it just stored is
  waiting.
- `test/helper-inbox-upload.test.ts` (new) covers the route's auth gate,
  size refusal, and stored sidecar.
