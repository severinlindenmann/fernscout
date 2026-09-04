---
id: B396
title: The contacts page tells an owner to change a trip's visibility, which no door can do
type: ISSUE
priority: medium
complexity: low
area: trips
found: "2026-09-04T22:44:10Z"
---

# B396 — The contacts page tells an owner to change a trip's visibility, which no door can do

## Why

The owner's contacts page warns correctly, and then names a remedy nobody can
perform:

> Approving someone lets them into the journal, but none of your trips are open
> to guests yet -- there is nothing for them to read. **Set a trip's visibility
> to guest to change that.**

Nothing can set it. `PATCH /api/v1/<user>/trips/<trip>` answers
`method_not_allowed`, and says so itself:

> This route takes DELETE and nothing else. A trip's own fields -- title,
> dates, **visibility**, people -- are not writable through an API: they are
> trip.md, and changing them is the owner's own edit.

On a hosted instance the owner has no shell and no editor, so "their own edit"
is not available either. The trip's visibility is fixed at creation, and the
banner asks for the one change that cannot be made.

This is B352's shape exactly -- a page naming `trip.md` as the remedy to
somebody who cannot open it -- and B352 was answered by building the door
(`PATCH .../rates`). The same argument applies here, and more strongly:
visibility is the setting an owner is most likely to get wrong at creation,
since it is decided before there is anything to look at.

Observed on fernscout.ch (f5561fe) on a journal whose only trip is private.

## Work

Either let `visibility` be written after creation -- owner only, refusing a
trip-scoped token, the way `.../rates` does, and noting that widening a trip
exposes days people could not previously read -- or stop naming an
impossible action and say what the owner can actually do, which today is
create a new trip with the right value.

Prefer the door. See B207 for the other frozen fields.

## Acceptance

The banner's instruction can be carried out through some door, or it no longer
names one that does not exist.
