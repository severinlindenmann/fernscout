---
id: B301
title: The handover block still offers the read-out-a-code route beside the key, which is two ways to do one thing
type: ISSUE
priority: medium
complexity: low
area: me-page, agents
found: "2026-09-04T14:22:00Z"
started: "2026-09-04T14:16:23Z"
session: a3370c43-40d9-471c-a3d3-1a30c49b5302
claimed: "2026-09-04T14:16:23Z"
---

# B301 — The handover block still offers the read-out-a-code route beside the key, which is two ways to do one thing

## Why

Asked by the owner on 2026-09-04, looking at the block B283 had just shipped.

B283 added the button that mints a twenty-minute key and prints a pasteable
prompt, and **kept the old route visible underneath it**:

> Oder gib stattdessen diese zwei Zeilen weiter und lies den Code vor, nach dem
> er fragt:
> `https://fernscout.ch/documentation.txt`
> `viki@severin.io`
> [Link kopieren]

That was a deliberate choice in B283 and it was the wrong one. The reasoning
was "nothing about the code flow was removed, so offer it" — but the page this
sits on is written for the reader least comfortable with software here, and the
one thing that page must not do is present two ways to do the same job and
leave the choice to somebody who has no basis for making it. Four lines and a
second copy button, under a heading that already has a copy button, is the
shape of an interface that has stopped deciding on the reader's behalf.

The code flow itself is **not** going anywhere: `POST /api/auth/request` and
`/verify` are unchanged, `/agent.md` documents them as the main path, and an
agent that cannot make an HTTP call of its own still uses them. What goes is
its second billing on this page.

## Work

Remove the `me.agentByHand` paragraph, the two `<p className="font-mono">`
lines and the `CopyLine` under them from `components/AgentHandover.tsx`. What
remains is the heading, the sentence, and the button.

Then:

- **`me.agentByHand`, `me.agentCopy` and `landing.copy`/`landing.copied` at
  that call site become dead** — check each against the rest of the codebase
  before deleting, since `landing.*` are the landing page's own and stay.
- **`docUrl` and `email` become unused props** on `AgentHandover` if nothing
  else renders them. If so, remove them and simplify both call sites
  (`app/[user]/me/MePageContent.tsx`, `app/[user]/trips/TripsIndexContent.tsx`)
  and `EmptyJournal` with them — `npm run unused` will not catch a prop nobody
  reads.
- **`test/copy-line-name.test.tsx` asserts on exactly this block** (B199: the
  accessible name for a two-value copy control). Those assertions are about a
  control that will no longer exist. Move what still applies to the prompt's
  own copy button, which has the same problem for a stronger reason — it copies
  a live credential — and delete what does not.

Not doing: removing the code flow, or changing `/agent.md`, which documents it
as the way in for an agent nobody pasted a key into.

## Acceptance

- `/<user>/me` and the empty trip list show the handover heading, its sentence
  and one button, and nothing about reading out a code.
- Signing in with a code still works end to end, and `/agent.md` still
  describes it.
- No orphaned translation keys and no unused props left behind; `npm run unused`
  clean.
- The B199 assertion about not reciting a copied value survives, pointed at the
  prompt's copy button.
- The four checks pass.
