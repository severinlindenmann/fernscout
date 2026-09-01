---
id: B28
title: Publishing a draft requires editing a file by hand, so an agent cannot close the loop it opened
type: FEATURE
priority: medium
complexity: high
area: api, drafts, mcp, docs
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
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

## What a second agent run added (2026-09-01)

An agent was asked to publish the drafts it had written and could not. Its
report is worth quoting, because it identifies a gap this task had not:

> Your guide tells an agent, four separate times, that "a person publishes it"
> — and never once says **how** a person does that. There's no editing
> interface by design, so the human reading my report has no obvious next move.
> I don't want to guess at it: whether it's a link in the welcome mail,
> something on the server, or a repo command, I haven't seen it stated anywhere
> I've read, and I'd rather say so than invent a plausible route.

That is a documentation defect independent of whether the endpoint is ever
built, and it is arguably the more urgent half. Today the honest answer is
"open `content/<user>/trips/<trip>/entries/<day>.md` in an editor and delete
`status: draft`" — which is fine for the author on their own laptop and
useless to somebody who was handed a journal by an agent and has never seen the
folder. The guide states the rule beautifully and leaves the person holding it
with nowhere to go.

The agent also proposed the smallest useful version, which does not require
deciding anything about the endpoint:

> The draft list endpoint would be a natural place to return it too:
> `list_drafts` could hand back the approval URL alongside the slugs.

So this task now has two halves that can ship independently:

1. **Say how a person publishes**, in `agent.md` and in the welcome mail, so an
   agent can end its report with "here is where you approve them". Whatever the
   answer is today, writing it down costs nothing and is owed.
2. **The endpoint or the link**, which is the decision below.

Note that half 1 gets much easier now that B27 has landed: the owner has a
session, so there is somewhere on the site to send them.

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

## The decision, and what was built

**The author decided: build the endpoint, over REST and MCP.** The prompting
observation was that an agent working around the gap by editing files over ssh
is cheating — it proves nothing and leaves the next agent exactly where the
last one was. That is right, and it is the argument this task needed.

So `POST .../days/<slug>/publish` and `publish_day`. What was kept:

- **Writing can never publish.** Nothing on `POST .../days` moves a day to the
  site — no parameter, and `create_day`'s schema is asserted not to grow one.
  This is the structural half and it is unchanged.
- **Owner only.** A trip-scoped token writes days into its trip and cannot
  publish them. Being on the trip is not deciding what the journal says. This
  is new, and narrower than the old file-editing route, which any hand on the
  server had.
- **Its own confirmation verb.** `publish_day` alongside `delete_draft` and
  `delete_published`, so a code obtained for one cannot act on another. Tested
  in both directions.

**What it does not guarantee, stated plainly because the old rule read as
though it did:** an agent holds both calls and can make them without asking
anybody. The confirmation makes publishing deliberate, not consented. The
honest description is "writing and publishing are structurally separate, and
the rest is instruction" — and `AGENTS.md`, `/agent.md` and `openapi.json` now
all say that rather than implying a human gate that was never enforced.

The existing MCP test `there is no tool that publishes` was rewritten rather
than deleted: it encoded the old guarantee, and the new one it should assert is
that *the tool which writes* cannot publish.

The documentation half shipped with it, which was the part that needed no
decision: `/api/v1/{user}/drafts` and `list_drafts` now return where each draft
is approved, so an agent can end its report with the answer instead of a shrug.

## Acceptance

Whichever route is chosen:

- **`/agent.md` says how a person publishes**, in as many words, near each of
  the four places it says that a person does. An agent reading it can tell
  somebody where to go. This holds even if the endpoint is never built.
- `GET /api/v1/{user}/drafts` and MCP's `list_drafts` return where the approval
  happens, alongside the slugs.
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
