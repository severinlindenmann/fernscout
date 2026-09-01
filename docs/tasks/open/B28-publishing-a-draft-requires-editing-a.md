---
id: B28
title: Publishing a draft requires editing a file by hand, so an agent cannot close the loop it opened
type: FEATURE
priority: medium
complexity: high
area: api, drafts, mcp, docs
found: "2026-09-01"
---

# B28 — Publishing a draft requires editing a file by hand, so an agent cannot close the loop it opened

## Why

An agent writes a day, tells the person it is waiting, and the person's only
way to say yes is to open `content/<user>/trips/<trip>/entries/<day>.md` in a
text editor and delete the line `status: draft`. For the author on their own
laptop that is fine and was the point. For somebody who was handed a journal by
an agent and has never seen the folder — which, since journal creation over the
API exists, is now a real person — it is a wall. The welcome mail says
"by removing one line from the file" to a reader who has no file.

**This task proposes changing the one rule, so read the reason it exists before
taking it.** `AGENTS.md`, `agentGuide()` and `openapi.json` all state that
nothing skips the draft step, in those words, three times, because the harm is
specific and unrecoverable: one invented memory presented to somebody's family
as fact. The guarantee is not "an agent is careful"; it is "a human saw it".
The proposal here keeps the human but moves where they stand — from editing a
file to answering a question — and that is a genuinely weaker guarantee,
because answering yes is cheaper than opening an editor and an agent asking
"shall I publish?" is a prompt the person may rubber-stamp.

What is being traded is therefore real, and the decision is the author's, not
an implementer's. Two things worth holding onto while deciding:

- The existing confirmation mechanism (`lib/agentConfirm.ts`) was built for
  precisely this shape of problem — a server-issued code, bound to the exact
  journal, trip, day and verb, that an agent cannot fabricate. It makes "the
  agent asked and was told yes" checkable rather than asserted. It is currently
  used for deletion, which is the mirror image of this.
- Whatever ships, an agent must not be able to write-and-publish in one motion.
  The value is in the gap between the two calls, not in the confirmation
  ceremony around the second.

## Work

Sketch, not a decision:

- A publish verb that only ever operates on a day that already exists as a
  draft, behind a `lib/agentConfirm.ts` confirmation whose message names the
  day and asks whether the person actually said to publish it.
- Never in the same request as the write, and never in a batch: one day per
  confirmation, so "yes" cannot be given once for work not yet read.
- The same verb over MCP, or neither door gets it.
- The three documents change together, and the sentence they change is the one
  the whole project is known by — `test/agent-interface.test.ts` asserts its
  current wording, deliberately.

An alternative worth pricing before building any of it: a **link in the
welcome mail and the drafts list that publishes**, so the yes comes from the
person's own browser and session rather than through the agent at all. That
keeps the guarantee exactly as strong as it is today and solves the same
problem — the person with no text editor — and it is probably less work. It
depends on B27, which gives the owner a session in the first place.

## Acceptance

Whichever route is chosen:

- A person who has never opened the content folder can publish a draft.
- An agent cannot cause a day to become published without a distinct,
  human-triggered step between writing it and publishing it — and a test
  asserts the two cannot happen in one call.
- `AGENTS.md`, `/agent.md`, `/openapi.json` and the welcome mail all describe
  the same rule, in whatever it becomes, and none of them still says "by
  removing one line from the file" if that is no longer the only way.
- If the answer is "no, keep it as it is": this file moves to `completed/` with
  that written at the top, and the welcome mail stops telling people to edit a
  file it has not shown them.
