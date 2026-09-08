---
id: B1009
title: The ask box on /agent is now the only underlined way into the room, beside a row that is not
type: ISSUE
priority: low
complexity: low
area: components/HelperAsk.tsx, components/AgentDoor.tsx
found: "2026-09-08T18:35:00Z"
started: "2026-09-08T21:17:09Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:17:09Z"
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

## Acceptance

Signed in as an owner at 390px, `/agent` offers no two controls of the same
intent in two different weights.
