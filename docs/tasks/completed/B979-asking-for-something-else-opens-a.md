---
id: B979
title: Asking for something else opens a box on the day rather than the room that can answer
type: FEATURE
priority: medium
complexity: low
area: day page, helper
found: "2026-09-08T16:10:32Z"
merged: "2026-09-08T16:20:32Z"
completed: "2026-09-09T16:45:31Z"
---

# B979 — Asking for something else opens a box on the day rather than the room that can answer

## Why

Under the owner block on a day sits "Ask for something else — in your own
words" (`components/HelperAskHere.tsx` → `HelperAsk`, B844). Pressing it opens
a text box in place, on the day page, with none of what the helper room has:
no files pane, no preview, no thread that survives the page.

The room exists — `/agent/<user>/chat` (B901/B902) — and it is where a request
can actually be answered and watched. Two places to say the same sentence, one
of which is a strictly worse copy of the other, is the shape B877 was cleaning
up in the first place.

The room's own URL is expected to move back to `/agent` shortly; that is
somebody else's ticket, so this one links by a single helper rather than
hard-coding the path in a component.

## Work

On a journal page (`onJournal`), make the opener a link to the room instead
of a disclosure that opens a box in place, carrying the day as context —
`?trip=<trip>&slug=<slug>` — so the room opens with that day in its preview
pane rather than whatever was last unfinished.

`app/agent/[user]/chat/page.tsx` reads those two search params and prefers
them over `draftsForWizard`'s first row for `opening`.

Not doing: removing `HelperAsk`'s in-place box — `/agent/<user>` still renders
it, and that page is the whole product on an instance whose room is off.

## Acceptance

As the owner on a day, press the link: the browser is at
`/agent/<user>/chat?trip=…&slug=…` and the preview pane shows that day. With
`helper` off, the link is not drawn at all. `npm run verify` green.
