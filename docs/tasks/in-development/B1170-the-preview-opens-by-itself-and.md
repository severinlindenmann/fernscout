---
id: B1170
title: The preview opens by itself and cannot be dismissed on a phone
type: ISSUE
priority: high
complexity: medium
area: helper room
found: "2026-09-09T20:04:47Z"
started: "2026-09-09T20:06:21Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T20:06:21Z"
---

# B1170 — The preview opens by itself and cannot be dismissed on a phone

## Why

On arrival the room picks the newest unfinished draft as the preview's
subject (`app/agent/page.tsx:104`–`112`), so the desktop column is already
filled with a months-old day and the phone sheet auto-"peeks" before the
person has done anything — `HelperRoom.tsx:299` peeks on any subject change,
and the sheet "never goes back to hidden" by design (`PreviewSheet`,
`HelperRoom.tsx:948`). The peek also *inserts itself into the layout flow*
(112px, `relative shrink-0`, B1160), pushing the composer up as a side
effect of a model answer. The owner's report: "die Vorschau ist immer offen,
auch wenn wir noch nichts gemacht haben".

## Work

- Drop the arrival subject: `opening` no longer seeds `subject`; the
  conversation's own opening cards already say what is unfinished.
  (`?about=` from a day link, B994, still opens that day — that one is an
  explicit arrival intent.)
- Phone: the sheet becomes open/closed only — opened by a day chip press or
  an accepted write, closed by its Close button back to hidden. Delete the
  peek state, its drag machinery and `SHEET_PEEK_PX`.
- Desktop: the rail stays collapsible; when a turn names a day while the
  rail is collapsed, draw a dot on the rail instead of opening it.
- Not doing: removing the preview column default-open state on desktop once
  a day IS named — a wide screen has the room for it.

## Acceptance

- A fresh signed-in visit at 390px shows no sheet and no peek; at 1280px
  the preview column shows its empty-state sentence, not a day.
- Pressing a turn's day chip opens the preview (sheet at phone, column at
  desktop); Close on the phone sheet hides it entirely.
- Nothing enters or leaves the layout flow when a model answer lands: the
  composer's bounding rect is unchanged before/after a turn that names a
  day (Playwright assertion).
