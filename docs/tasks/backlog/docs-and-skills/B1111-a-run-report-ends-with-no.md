---
id: B1111
title: A run report ends with no way to say which tickets a person accepted
type: DOCS
priority: high
complexity: low
area: skills
found: "2026-09-09T16:48:23Z"
---

# B1111 — A run report ends with no way to say which tickets a person accepted

## Why

`report-a-run` deliberately ends without a decision bar: "`triage-a-backlog`
ends in a choice; this ends in a handover, and buttons on finished work would
only invite a person to re-decide something already merged."

That was the wrong call, and the reason is the lane. A merged ticket sits in
`testing/` until a person has seen it working — that is the second of the two
human gates, and an agent never passes it. The report is exactly where a
person forms that opinion: it is the page with the before and the after on it.
Ending it with no way to record the answer means the person reads the page,
decides, and then has to go and compose the instruction by hand — or, far more
likely, does not, and the lane accumulates until somebody clears 284 of them
in one sentence, which is what happened here on 2026-09-09.

The buttons are not re-deciding merged work. They are the acceptance gate,
which is a person's and has never had a surface.

## Work

Give `report-a-run`'s artifact a closing selection, built on the same
machinery `triage-a-backlog`'s decision bar already uses (localStorage under a
versioned key, clipboard with an honest report of whether the write resolved,
a readonly textarea as the fallback, never a download):

- Every ticket row carries **accept / needs another look**, nothing
  pre-selected, and the tally in the sticky bar counts the undecided.
- "Build the list" writes a paste-ready instruction as its first line —
  `move B1097 B1099 B1100 to completed` — followed by the tickets held back,
  each with whatever the person typed in its note field.
- The closing box ("what still wants your eyes") stays exactly as it is. It is
  the thing the person reads *before* pressing the buttons.

Not doing: letting the report move a task file itself. `completed/` is a
person's gate; the deliverable is still text in their clipboard.

## Acceptance

- The artifact's clipboard block starts with a line an agent can act on with
  nothing added.
- A ticket the person marked "needs another look" appears below that line with
  its note, and is not in the move list.
- The skill still says, in words, that the report does not move anything.
