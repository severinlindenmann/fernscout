---
id: B1083
title: The inbox, and taking a photograph back off a day, are unreachable from the conversation
type: FEATURE
priority: medium
complexity: medium
area: lib/helper/tools/areas/files.ts
found: "2026-09-09T15:42:01Z"
merged: "2026-09-09T15:42:47Z"
completed: "2026-09-09T16:45:51Z"
---

# B1083 — The inbox, and taking a photograph back off a day, are unreachable from the conversation

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A photograph could be added to a day and never taken off, and a file staged in
the inbox could be listed on a page and never discarded. Both had v1 routes; a
browser holds a cookie and not a bearer token, so neither door was reachable
from the room.

## Work

`inbox` (read), `remove_photo`, `discard_file`. The photograph is never named
by the model: it comes from a tick in the files pane, or from a `src` that must
match an item actually on the resolved day. Anything else proposes nothing.

`remove_photo`'s card shows the day and the photograph's own filename, and says
plainly that the picture and its kept original both go and there is no undo.

## Acceptance

Tampering a pressed proposal's `src` to a value the day does not carry is
refused with `unknown_media` and both photographs stay on disk —
`test/helper-files.test.ts`. Ticking a file and pressing empties the inbox.
