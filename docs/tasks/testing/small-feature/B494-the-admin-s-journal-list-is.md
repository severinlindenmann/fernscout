---
id: B494
title: The admin's journal list is a page of identical cards
type: FEATURE
priority: medium
complexity: low
area: home view
found: 2026-09-05T00:00:00Z
merged: "2026-09-05T15:55:19Z"
---

## Why

B480 put every journal on the instance into the operator's list on `/`, and
B488 labelled the ones that are not theirs. Both are right and the result is
still wrong to read: six full cards, each with its trip links, its path, its
count and the same sentence of small print repeated six times. The one card
that is actually theirs is buried in it, and the repetition is what does the
burying — the eye has nothing to skip.

The list only grows. This is the operator's own instance, so every journal
anybody signs up for lands here.

## Work

Split the list in `components/HomeJournals.tsx`. Journals the address holds a
real role in — `owner`, `traveller`, `guest` — keep the card they have. The
`admin` ones become one section below: a heading, the sentence **once**, and a
row per journal with its title, its path and its trip count. No trip links, no
badge — the section is the badge.

`home.role.admin` stops being rendered and goes, along with the per-card
`home.adminHint`; `home.adminSection` and `home.adminSectionBody` replace them
in en, de and hu.

Not doing: a cap with "and N more". A row is one line, and an operator looking
for a journal wants to see it rather than a count.

## Acceptance

With `FERNSCOUT_ADMIN_EMAIL` set and six journals on the instance, `/` shows
one card and five rows, and the "not yours" sentence appears once.
