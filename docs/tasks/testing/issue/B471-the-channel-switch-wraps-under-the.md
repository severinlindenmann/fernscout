---
id: B471
title: The channel switch wraps under the channel name on a phone, and the estimate table is too wide for one
type: ISSUE
priority: low
complexity: low
area: credits, me page, mobile
found: "2026-09-05T13:24:17Z"
merged: "2026-09-05T13:32:33Z"
---

# B471 — The channel switch wraps under the channel name on a phone, and the estimate table is too wide for one

## Why

B463 put a switch inside the first cell of the estimate table
(`MePageContent.tsx`), beside the channel's name. On a phone that cell is about
a hundred and thirty pixels wide and "WhatsApp" is longer than "E-Mail", so one
switch sits on the name's line and the other wraps below it — two rows of
different heights, neither aligned with the numbers they belong to. The word
"an" beside each switch costs width and says what the switch already says.

The table itself is what makes it that narrow. Four pieces of information per
row — channel, switch, recipients, cost — under three column headings, one of
which ("Aktive Empfänger") already wraps to two lines on a phone. A table earns
its keep when columns are compared down the page; here there are two rows, and
what the owner compares is one row against the total under it.

## Work

- The estimate becomes a list rather than a table: the channel and its switch
  on one line, the recipients and what they cost on a quieter line under it,
  the total unchanged at the bottom.
- The switch goes to the right edge of its own row — one column of switches,
  reachable by thumb, aligned whatever the channel is called.
- Drop the "an"/"aus" label: `role="switch"` with `aria-checked` already says
  it to a screen reader, and the switch itself says it to everyone else. The
  failure line stays, because that one is not visible in the control.
- The three column headings go with the table; `me.paymentUpTo` grows its own
  noun so the number is not left unlabelled.

Not doing: a second layout for wide screens. The panel sits beside the balance
well and is narrow there too, so the list is the better shape at both ends.

## Acceptance

- At 360px both switches are on their channel's line, right-aligned to each
  other, with no wrapped row.
- The total still falls to zero with both channels muted.
- `npm run verify`.
