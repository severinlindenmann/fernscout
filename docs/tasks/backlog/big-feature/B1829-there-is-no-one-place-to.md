---
id: B1829
title: There is no one place to do things, so every action needs an agent or a hidden control
type: FEATURE
priority: high
complexity: high
area: studio, ui, design, i18n
found: "2026-09-17T05:11:47Z"
---

# B1829 — There is no one place to do things, so every action needs an agent or a hidden control

## Why

A person who owns a journal has no front door. Editing a day is a panel you
only find if you are already looking at that day (`components/EditDay.tsx` via
`OwnerTools`). Making a trip is possible only by talking to `/agent`. Bringing
photographs in is at `/[user]/extract`, under a name describing what the
software does to the file. Inviting somebody is a different page again. Nothing
lists what a person can actually do.

The result is that the honest answer to "how do I do X" is usually "ask the
agent", which is how a product ends up depending on a model being good enough —
the assumption this whole direction is stepping away from.

**Fernscout has three front doors** (`docs/plans/2026-09-17-the-studio.md`):
the studio for anybody, a person's own agent against the v2 API for those who
have one, and WhatsApp for the daily entry. Two of them must reach everything.
This ticket is the first.

The shape is already proven: the photographs import
(`components/extract/ExtractFlow.tsx`) is a real multi-step, resumable,
preview-then-decide flow. It turned out to be a general answer wearing an
import costume.

## Work

Two things, and they are one piece of design.

**The flow skeleton** — a reusable sequence every action wears:
what this is → gather → preview → decide → do it. Not every flow needs all
five; every flow uses them in this order. Rules that hold across all of them:

- nothing is written before the last step, so backing out leaves the journal
  untouched
- a flow can be left and resumed — `ResumeScreen` already does this for
  photographs and generalises
- steps are self-sufficient, needing nothing from elsewhere in the app; this is
  the rule that lets B1826 delete the documentation
- the final button is named after its consequence, never "Next" or "Save"
- publishing is always its own decision, never a side effect of a flow
- confirmations use `components/ConfirmPanel.tsx`

**The hub** at `/[user]/studio` — the flows grouped by what a person is trying
to do, the main one first and largest. A flow that cannot run right now is
shown with the reason rather than hidden; hiding it is how somebody concludes
the software cannot do something it can. An empty journal sees one call to
action, not a grid of things it cannot do yet.

**Built with B1824**, which is where the skeleton lands — that ticket's
five-step import shape is this skeleton, minus the import costume. The two
should be taken together.

Each flow should have its own linkable, resumable URL, because that is how
B1820's WhatsApp redirects reach *into* a flow rather than dropping somebody at
the hub.

Not doing here: the individual flows. They are B1830, B1831, B1832, B1833, and
the already-captured B1821, B1822, B1823.

Not doing here: removing anything from `/agent` or from `OwnerTools`. Pruning
follows a flow shipping, and whether the day page keeps its own controls is an
open question in the plan.

**Door two must keep pace.** Every flow reaching a capability the v2 API cannot
reach breaks the "bring your own agent" promise. Run `keep-the-contract` as
flows land.

## Acceptance

- `/[user]/studio` lists every flow, grouped, with the main flow prominent.
- A flow built on the skeleton can be left and resumed.
- Nothing is written before a flow's final step, and that button names its
  consequence.
- A flow that cannot run shows why.
- Real English, German and Hungarian entries for every new string;
  `npm run i18n:keys` clean.
- Verified in a real browser at desktop and phone width, including the empty
  journal.
- `npm run verify` passes.
