---
id: B581
title: A day that declined photographs is still tipped to add some
type: ISSUE
priority: low
complexity: low
area: fernscout-helper, validate-content, tips
found: "2026-09-06T14:03:33Z"
started: "2026-09-06T14:13:05Z"
merged: "2026-09-06T14:18:13Z"
completed: "2026-09-07T13:12:13Z"
---

# B581 — A day that declined photographs is still tipped to add some

## Why

Found on 2026-09-06 while verifying B577.

`validate-content/validate.mjs:344-346`:

    const gallery = entry.data.gallery;
    if ((!gallery || (Array.isArray(gallery) && gallery.length === 0)) && tracks.photos !== false) {
      tip(entryWhere, "has no photographs", "POST them to …/trips/<trip>/media with this day's slug");
    }

The guard asks whether the *trip* tracks photographs. It does not ask whether
*this day* has already answered. A day carrying `without: [photos]` has said,
explicitly and on purpose, that it had none — and is still nudged to add some.

It is only a tip, so nothing is wrong and nothing is refused. It is wrong in
the way this repository has already decided tips must not be: the commit that
built the fixtures is called *"Three fixture journals, and the tips a settled
question should not raise"*, and `SKILL.md` makes the same point — a tip is an
offer, and an offer to answer a question already answered is noise that trains
the reader to skim the list.

The costs branch nearby gets this right: a day carrying `without: [costs]` or
`unrecorded: [costs]` is not asked about costs again. Photographs simply never
got the same treatment.

## Work

- Extend the guard to the day's own answer: skip the tip when
  `without:` includes `photos`. Match how the costs branch reads `without` and
  `unrecorded` so the two cannot drift.
- `unrecorded: [photos]` — *there were some and they are gone* — should skip it
  too if the instance accepts that shape for photographs; check the published
  schema rather than assuming, and say in the task which answer it gave.
- Give `halbfertig` a day that declines photographs, so a regression shows up
  as that fixture no longer being clean. It already has entries using
  `without`, so this is one line.

## Acceptance

- A day with `without: [photos]` raises no photographs tip; a day with an empty
  gallery and no such line still does.
- `halbfertig` stays at 0 errors and 0 warnings with the new day present.
