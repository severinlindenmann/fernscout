---
id: B816
title: A published day cannot be corrected or taken down without an agent
type: FEATURE
priority: high
complexity: high
area: agent, entries, ui
found: "2026-09-07T15:30:50Z"
started: "2026-09-07T15:37:35Z"
merged: "2026-09-07T16:05:50Z"
---

# B816 — A published day cannot be corrected or taken down without an agent

## Why

A 47-year-old tester, home three weeks after a trip, tried the six things a
person actually does afterwards. Four of them have **no browser affordance at
all** for the journal's own owner, signed in, on her own pages:

| | |
| --- | --- |
| Fix a typo in a published day | agent or API only |
| Add photographs she forgot | agent or API only — the wizard offers upload for *drafts* only |
| Enter the receipts she kept | agent or API only (see B820) |
| Take a day down because a friend in a photo asked | agent or API only, and it is a permanent delete, not a takedown |

> "The product's browser surface is built entirely for the moment of writing.
> Once a day is on the site, the browser becomes read-only for its owner."

The takedown is the one that matters most, and the ticket writes itself out of
this project's own history: **B28 exists because telling somebody to delete a
line from a file was advice with nowhere to go.** A person whose friend asks to
be taken out of a photograph, and who has no agent, has exactly that problem
again — an email to whoever set up the journal, or living with it.

"The agent is the editor" was never meant to mean "the agent is the *only*
editor". `/agent` exists so a person without one can keep their own journal.

Every capability needed already exists: `PATCH .../days/<slug>` corrects,
`POST .../media` adds photographs, `DELETE .../days` removes with a two-step
confirmation. None of them is reachable from a screen.

One asymmetry the tester found and nothing explains: correcting a published day
republishes instantly with **no confirmation**, while deleting one needs a
signed two-step token. That is defensible — one is reversible and one is not —
but a person discovers it only by trying.

## Work

Bring the four into the helper, and mind the gates:

- **Correcting** — the wizard already knows how to load a draft. Let it load a
  published day, and make plain that saving a published day updates what people
  can already read. **An edit must not become a way to publish without the
  tap** (the roadmap's own warning).
- **Adding photographs** to a published day: the same upload the draft path
  uses.
- **Taking down**: prefer an *unpublish* — back to draft, off the site,
  reversible — over `DELETE`, which is permanent and orphans the photographs.
  A takedown a person can undo is the right shape for "a friend asked". If a
  real delete is offered too, it keeps its confirmation.

Do the takedown first if this is split: it is the one with somebody else's
consent behind it.

## Acceptance

An owner with no agent can fix a name, add a photograph and take a day off the
site, from the browser, and can undo the takedown.
