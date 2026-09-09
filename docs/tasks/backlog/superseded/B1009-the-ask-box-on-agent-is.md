---
id: B1009
title: The ask box on /agent is now the only underlined way into the room, beside a row that is not
type: ISSUE
priority: low
complexity: low
area: components/HelperAsk.tsx, components/AgentDoor.tsx
found: "2026-09-08T18:35:00Z"
superseded: "B984"
---

# B1009 — The ask box on /agent is now the only underlined way into the room, beside a row that is not

## Why

Noticed while building B1007, in a browser at 390px on `/agent` signed in as
the owner. The journal card now reads, top to bottom:

- **Finish Friday, 30 April** — the yellow button, the one bright thing.
- **Or talk it through** — B1007's quiet row, a bordered full-width control.
- **Or ask me something** — `HelperAsk`, still an underlined link.

Two "or" openings in a row, in two weights, and the second one is the weight
B1007 has just finished retiring everywhere else. It was consistent before —
two underlined lines under a button — and the fix made it inconsistent, which
is the honest cost of doing one of three at a time.

Not folded into B1007 because it is a different control with a different job:
`HelperAsk` opens a box in place and B1007's rows are links to the room. Which
of the two should survive on this card is a question about the page, not about
the row style, and B984 (the conversation lives at three URLs and should live
at one, in development) may answer it first.

## Work

Look at the card as a whole once B984 has landed. Either give `HelperAsk` the
same `AgentRow` geometry, or decide the card does not need three ways in and
drop one.

## Findings (2026-09-08, superseded)

B984 landed (`Merge B984: /agent is the room, and it opens by saying what is
there`, `a68b5b5d`/`81d02ba3`, and its follow-ups through `6abc09b7`) before
this ticket was picked up, and it answered the "Work" section's own question
by dropping the card outright rather than by unifying the two rows on it.

`app/agent/page.tsx` now renders `HelperRoom` directly for a signed-in owner
whose journal has `helper` on — no journal card, no yellow "Finish Friday…"
button, no `AgentRow` "Or talk it through" row, and no separate `HelperAsk`
link beside it. `HelperAsk` is the room's own always-present field (rendered
`inRoom` at `components/HelperRoom.tsx:351`), not a link that opens one.

`components/AgentDoor.tsx` is what is left for everyone else — signed out, or
signed in with no helper-enabled owned journal — and it draws none of the
three controls this ticket described either. Its own docstring (lines 58-69)
still describes the old per-journal card; the code beneath it does not build
one any more. Confirmed with `npx eslint components/AgentDoor.tsx`: `AgentRow`,
`HelperAsk`, `AgentHandover`, and the `LOW_CREDITS` constant are all imported
or declared and never used in this file (8 unused-var warnings, 0 errors —
harmless to `npm run verify` but real dead code, unrelated to this ticket's
ask and filed separately as B1034).

So the inconsistency named in the ticket — two "or" openings on one card, in
two visual weights — no longer exists anywhere on `/agent`: the card that had
both is gone. Nothing to unify. No code changed for this ticket.

The cleanup half (removing the now-dead
`AgentRow`/`HelperAsk`/`AgentHandover`/`LOW_CREDITS` leftovers in
`AgentDoor.tsx`, and correcting its stale docstring) is a distinct, smaller
finding — captured as B1034.

## Acceptance

Signed in as an owner at 390px, `/agent` offers no two controls of the same
intent in two different weights.

**Superseded by B984**, which removed the card these controls lived on. There
is now exactly one way into a helper-enabled owner's room from `/agent`: the
room itself. A person can still confirm this by eye at 390px if wanted, but no
build is owed here.
