---
id: B949
title: The files pane's count is announced by a region that does not exist until it changes
type: ISSUE
priority: medium
complexity: low
area: helper, ui, a11y
found: "2026-09-08T10:46:43Z"
started: "2026-09-08T10:57:15Z"
merged: "2026-09-08T11:02:57Z"
completed: "2026-09-09T16:47:27Z"
---

# B949 — The files pane's count is announced by a region that does not exist until it changes

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`FilesPane` in `components/HelperRoom.tsx` renders

```tsx
{selected.length > 0 && <span role="status">{n} selected</span>}
```

so the live region is created at the same moment as its first content. A screen
reader may never announce that first change — the region was not there to be
watched.

The conversation log itself already has this fixed, and the comment beside it
(`components/HelperRoom.tsx:501`) says why in those words. The second live
region on the same screen did not get the same treatment.

The effect: somebody ticks their first photograph and hears nothing. They would
have to tab onward and find a "Clear" button to learn that anything was
selected.

Found by static reading rather than by hearing it — the journal under test had
an empty inbox — which is worth saying in the file, and does not weaken it: the
markup is the same shape as the bug already fixed once here.

## Acceptance

The span is in the DOM from the first render, with no count in it, and a test
asserts it — the same assertion the log's own region has.
