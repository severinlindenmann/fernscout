---
id: B1016
title: The room's two panes are chrome at the top rather than part of the conversation
type: FEATURE
priority: high
complexity: medium
area: helper, ui
found: "2026-09-08T19:09:44Z"
started: "2026-09-08T19:09:45Z"
merged: "2026-09-08T19:55:54Z"
---

# B1016 — The room's two panes are chrome at the top rather than part of the conversation

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

At 390px the room opens with a back bar, then a row carrying the journal's name
and two pills — **Dateien** and **Wie es aussieht** — then the notice, then a
large empty cream void, then the composer. The owner's reading of it:

> I would rather have a really small emoji or thumbnail in the chat with a
> button Preview, and not a button at the top. Dateien should be somewhere
> else, maybe a pane below the chat that can be toggled.

Both instincts are right and they are the same instinct: **the panes are
global chrome for things that are local.** A preview is about *one day* — the
one a turn just named — so it belongs in that turn. Files are picked up when
you are about to say something about them, so they belong beside the field, not
above the conversation.

One of the two pills also ships **disabled**: `Wie es aussieht` has nothing to
show until a day is under discussion, so a new owner's first impression
includes a greyed-out control.

## What was decided

Three directions were drawn (artifact, 2026-09-08) and all three were
accepted. They are only rivals in one place, and it resolves:

- **The preview goes inline** — a small thumbnail card inside the turn that
  named the day, with a press that opens it. Both header pills go.
- **Files become a slim strip above the composer**, which expands into a
  drawer and collapses when the field takes focus.
- **The drawer is one mechanism**, not two: once the preview is inline it needs
  no shelf, so what would have been a two-tab drawer is simply the files one.

## The arithmetic that shapes it

The literal “pane below the chat” does not fit, and the numbers are worth
keeping. On a 390 × 844 phone with the keyboard up, after the back bar (56),
the room header (44) and the composer (92), a tray taking 40% of the height
leaves the conversation **64px short of zero**. A 50px strip leaves 126px —
two lines of conversation.

So the strip is the honest form of the pane, and the drawer is what it becomes
when somebody actually wants to look.

## What must not regress

- **The third live region.** The strip would be the third on this screen, and
  B949 is the record of what happens when one is mounted at the same moment as
  its first content. It exists from the first render, empty.
- **Focus.** A drawer that opens over the field has to say where focus goes and
  how it comes back — B918 and the room's own focus comments.
- **Desktop keeps its three columns.** The inline card renders there too and
  scrolls the preview column to that day rather than opening anything.

## Acceptance

At 390px: no pills in the header, a preview reachable from the turn that named
a day, files reachable without leaving the conversation, and the conversation
never shorter than two lines with the keyboard up.
