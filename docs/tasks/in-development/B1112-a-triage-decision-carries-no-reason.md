---
id: B1112
title: A triage decision carries no reason, so the run brief starts from ids alone
type: DOCS
priority: medium
complexity: low
area: skills
found: "2026-09-09T16:54:38Z"
started: "2026-09-11T14:51:59Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T14:51:59Z"
---

# B1112 — A triage decision carries no reason, so the run brief starts from ids alone

## Why

`triage-a-backlog`'s decision bar records a verdict per ticket and nothing
else. A person working through forty rows forms an opinion far more specific
than *promote* — "yes, but only the read side", "promote, and it is the same
work as B1054", "hold until the helper router lands" — and every word of it is
thrown away at the moment they press the button. The generated block is a list
of ids, and `plan-a-run` starts from ids alone, so the reasoning has to be
reconstructed by an agent reading the ticket file, which is precisely the
document that did not carry it.

B1111 is adding the same thing to `report-a-run`'s acceptance gate, for the
same reason and with the same shape. Doing one and not the other leaves the
two ends of the loop inconsistent.

## Work

In `.claude/skills/triage-a-backlog/SKILL.md` step 6, give every ticket row a
note field beside its three buttons, and carry what is typed into the
generated block beside that ticket's id — under the paste-ready `plan-a-run`
line, so the ids stay a single clean line an agent can act on and the notes
follow as context beneath it. An empty note contributes nothing: no blank
bullet, no placeholder.

Then say, in `plan-a-run` step 1, that a note arriving with a ticket id is
input to that ticket's question set — not a decision already made, but the
thing the person was thinking when they chose it.

Not doing: any change to the three verdicts, the sketches, or the artifact's
structure.

**Done.** `triage-a-backlog` step 6 now gives every ticket row a note field
open regardless of which of the three buttons is pressed, following
`report-a-run`'s own gate shape rather than inventing a second one — same
"carried beside the id, empty note contributes nothing" rule, same reasoning
quoted almost verbatim. The paste-ready block's existing grouped list now
carries that note beside the id, below the `plan-a-run <ids>` line, unchanged
in every other respect. `plan-a-run` step 1 now says a note arriving with an
id is input to that ticket's question set — read before step 2, handed to the
subagent alongside the ticket file — and is explicit that it is not the same
weight as a `## Decided` section: a subagent still checks it against the code
rather than taking it as given.

## Acceptance

- A note typed against a promoted ticket appears in the clipboard block under
  the `plan-a-run` line, attributed to its id; a ticket with no note adds no
  line.
- `plan-a-run` says what to do with one.
