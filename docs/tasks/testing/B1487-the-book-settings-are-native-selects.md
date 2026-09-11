---
id: B1487
title: The book settings are native selects and a nine-item checkbox list where the drawing has a card of rows
type: FEATURE
priority: high
complexity: medium
area: photobook
found: "2026-09-11T16:50:26Z"
started: "2026-09-11T17:12:13Z"
merged: "2026-09-11T17:30:17Z"
---

# B1487 — The book settings are native selects and a nine-item checkbox list where the drawing has a card of rows

The drawing shows the settings as a card of rows: a label on the left, a switch
on the right, and `Language  Deutsch` as a plain row. What ships is two native
`<select>`s with their own chrome, a nine-row list of checkboxes each with its
own sentence, two links and a disclosure — about four hundred pixels of form
where the drawing has five rows.

It is the screen the owner was shown and said was ugly, and they are right: it
reads as a settings dialog from another application dropped into a cream page.

## Work

`BookSettingsPanel.tsx` keeps every control it has — nine options are nine
options and none of them goes — but renders them in the drawing's grammar:

- one card, `divide-y` rows, label left and control right;
- a switch for each boolean rather than a checkbox in a list;
- the two selects as a right-aligned value with a chevron, not a native box;
- the per-option sentences behind the row rather than under each one — they
  are what makes it four hundred pixels tall.

Not doing: removing an option, or changing what any of them mean.

## Acceptance

Every option still reachable and still working at 1280 and 390; the panel is
the drawing's card; no native select chrome on the page.