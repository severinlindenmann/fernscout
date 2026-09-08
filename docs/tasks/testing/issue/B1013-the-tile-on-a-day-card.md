---
id: B1013
title: The tile on a day card offers to take the day down and the panel it opens cannot
type: ISSUE
priority: medium
complexity: low
area: components/OwnerTools.tsx, site/locales
found: "2026-09-08T19:05:00Z"
started: "2026-09-08T18:59:41Z"
merged: "2026-09-08T19:13:13Z"
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

`EditDay`'s own doc comment says it outright — *"It cannot publish and it
cannot unpublish. That is B28's separation"* (`components/EditDay.tsx:67`). So
nothing is confused about what the panel does; only the label on the tile that
opens it drifted, when B980 pointed an existing tile at a new destination.

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

## What was done

`agent.editDay` — "Edit" / "Bearbeiten" / "Szerkesztés" — on the panel branch;
`agent.correctDay` unchanged on the wizard branch. A case in
`test/owner-tools.test.ts` asserts the split, and asserts `EditDay` calls no
`/unpublish` route — so if the panel ever grows one, that test is what says the
labels need looking at again.

## One thing carried in from outside this ticket

B984 merged into `main` while B1012 was in its worktree and moved the room to
`/agent?about=<ref>`. It could not see B1007's draft-row case, which had landed
in between, so that assertion in `test/helper-ask-on-the-day.test.tsx` was left
naming the old URL and `main` went red — a clean merge with nobody's conflict,
which is the shape B880/B881/B883/B896 already record. Corrected on this
branch, in the same words a parallel session had already written in the shared
checkout, so the merge cannot clobber their copy.

The lesson is the one `work-on-a-task` already gives and I skipped: verify on
`main` **after** the merge, not only on the branch.

## Acceptance

- On a published day card, the tile reads "Bearbeiten" (de) / "Edit" (en) /
  "Szerkesztés" (hu), and the panel it opens does everything the label says.
- On the trip overview the tile still reads "Korrigieren oder entfernen", and
  the wizard it opens still has its take-down control.
- `site/locales/{en,de,hu}.json` all carry the new key; `npm run verify` clean.
