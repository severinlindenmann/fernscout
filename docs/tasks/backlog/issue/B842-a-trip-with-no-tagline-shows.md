---
id: B842
title: A trip with no tagline shows the journal's, so the journal's words are presented as the trip's
type: ISSUE
priority: medium
complexity: low
area: trip, header
found: "2026-09-07T18:30:00Z"
---

# B842 — A trip with no tagline shows the journal's, so the journal's words are presented as the trip's

## Why

Reported by the owner, looking at their own journal: *"why is my journal
subtitle also the subtitle of my trip? My trip has no subtitle."*

`components/TripHero.tsx:125`:

```ts
const subheading = localized.tagline ?? site.tagline;
```

The comment above it says the fallback is there so the masthead does not have
a gap — *"the line is part of the masthead's shape"*. That is a layout reason,
and it loses to a correctness one: the hero's heading is the **trip's** title,
so the line under it reads as the trip's subtitle. Putting the journal's words
there attributes them to a journey they were not written about. The owner's
journal tagline is a row of emoji describing the two of them; on the trip page
it reads as a description of Algarve 2026.

It is also visibly duplicated. `PageHeader` renders the journal's tagline
under the journal's name (`PageHeader.tsx:33-35`), directly above the hero, so
on a trip with no tagline the same string is on screen twice — once correctly
and once not. That is what made it noticeable.

## Work

- Drop the fallback: no trip tagline means no line. Let the masthead be one
  line shorter rather than borrow words.
- Check the spacing holds without it — the reason it was added was that the
  gap looked wrong, so the fix is spacing that does not depend on the line
  being there, not a different string.
- `PageHeader`'s own fallback is a different case and is **correct**: there the
  heading is the journal's name, so the journal's tagline belongs under it.
  Leave it.

Not doing: giving trips a tagline where they have none, or changing what
`trip.md` accepts.

## Acceptance

- A trip with no `tagline:` shows no subtitle line, and the journal's tagline
  appears exactly once on the page — under the journal's name in the header.
- A trip that *has* a tagline still shows its own.
- The masthead does not collapse or shift oddly without the line.
- Checked at 390px.

## Done

The fallback is gone and the `<p>` is now conditional, so a trip with no
tagline is genuinely one line shorter rather than carrying an empty paragraph
and its margin.

**This overrules a deliberate decision, which is why it is written down.**
B765 introduced the fallback and `test/trip-hero-masthead.test.ts` asserted
it — *"a trip with no tagline still falls back to the journal's"*. That test
now asserts the opposite, with the reasoning in it, so the next reader sees
that the change was made rather than lost. B765's main point stands untouched:
the heading is the trip's title and there is no `isCurrent` branch.

`PageHeader`'s own fallback is unchanged and remains correct — there the
heading is the journal's name, so the journal's tagline belongs beneath it.
