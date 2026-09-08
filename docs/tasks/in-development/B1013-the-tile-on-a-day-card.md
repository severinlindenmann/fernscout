---
id: B1013
title: The tile on a day card offers to take the day down and the panel it opens cannot
type: ISSUE
priority: medium
complexity: low
area: components/OwnerTools.tsx, site/locales
found: "2026-09-08T19:05:00Z"
started: "2026-09-08T18:59:41Z"
session: 79cece02-4661-45ef-809b-52b592e67f95
claimed: "2026-09-08T18:59:41Z"
---

# B1013 — The tile on a day card offers to take the day down and the panel it opens cannot

## Why

`agent.correctDay` reads "Correct or take down" / "Korrigieren oder entfernen"
/ "Javítás vagy levétel", and `OwnerTools` renders it for both of its branches
(`components/OwnerTools.tsx:143`).

The two branches do different things, and only one of them can take a day down:

- **Trip overview** — a `Link` to the wizard, which has `takeDown()`
  (`components/AgentWizard.tsx:945`, `POST …/unpublish`) behind a
  `ConfirmPanel`. The label is true here.
- **Day card** — `onCorrect`, which opens `EditDay` (B980). There is no
  unpublish, no delete and no route call of that kind anywhere in
  `components/EditDay.tsx`. The label is false here.

It is the same failure the project keeps writing down in its own words: the
sentence on the screen is all a person has, and this one offers a capability
the panel does not have. Somebody who wants a day off the site presses it,
gets an editor, and has no idea where the thing they were promised went.

## Work

Give the panel branch its own key — "Bearbeiten" / "Edit" / "Szerkesztés" —
and leave `agent.correctDay` on the wizard branch, where taking down is real.
The two never appear on the same page, so there is nothing to reconcile.

Not doing: adding unpublish to `EditDay`. That is a second decision about a
panel B980 deliberately kept to one job, and it is a capture of its own if
anybody wants it.

## Acceptance

- On a published day card, the tile reads "Bearbeiten" (de) / "Edit" (en) /
  "Szerkesztés" (hu), and the panel it opens does everything the label says.
- On the trip overview the tile still reads "Korrigieren oder entfernen", and
  the wizard it opens still has its take-down control.
- `site/locales/{en,de,hu}.json` all carry the new key; `npm run verify` clean.
