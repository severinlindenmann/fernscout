---
id: B1593
title: A closed journal has no way to show a public shopfront of the parts its owner would share
type: FEATURE
priority: medium
complexity: high
area: visibility, gallery, trips
found: "2026-09-12T15:46:33Z"
---

# B1593 — A closed journal has no way to show a public shopfront of the parts its owner would share

## Why

Asked for by Severin, 2026-09-12, in his own words:

> allow part of your journal to the public, for e.g. when i specifically set
> "public" on a media and set galerie to public, people can see part of my
> public galerie, or when i set "Gesperrte Karte zeigen" on travels, people can
> see my page https://fernscout.ch/severin/trips, just with the cover image,
> from when to when and how long but can not open it and see any days of it —
> gives a person that has a guest or private journal to have some sort of
> public travel portfolio but only showing mostly pictures he wants public.

Today the journal is all-or-nothing at the top: a journal's own `visibility` is
`public` or `guest`, and `guest` means the whole thing is unadvertised. Inside
it, everything only ever narrows — `teaser: true` (B587) puts a locked card on
`/<user>/trips` with a title and dates for a reader who is *already* let into
the journal, and a gallery item's `visibility` (B596) has `guest` and `private`
and deliberately **no `public`**, because a label that widens is a way past the
trip's gate rather than behind it.

So somebody who keeps their journal closed has no shopfront. The thing they
want to show a stranger — that they travel, roughly where and when, and a
handful of photographs they are happy to have on the open web — is exactly the
thing they cannot show without opening the trips themselves.

## Work

Not decided. The shape of the answer matters more than the code, and this
ticket is the argument, not the build. Three things to settle first:

1. **Does this widen, or is it a second surface?** The "narrows, never widens"
   rule in AGENTS.md is load-bearing — `visible()` in `lib/entries.ts` and
   `app/[user]/media/[...path]/route.ts` both rest on it, and a `public` value
   on a gallery item inside a `guest` trip inverts it. The safer shape is
   probably a **portfolio the owner curates explicitly** — a separate, opt-in
   list of items and trip cards the journal publishes — rather than a third
   value on the existing `visibility` field. A curated list can only ever
   contain what the owner put in it; a widening label leaks the day anything
   downstream forgets to ask.
2. **What a locked card may say to a stranger.** B117 decided a closed trip
   does not name itself to an uninvited reader, because trip ids are guessable.
   The request is for cover image + dates + duration on a public page, which is
   the opposite decision one level out. It is probably fine *when the owner
   asked for it per trip* (that is what `teaser:` already is), and not fine as
   a default — but it needs saying out loud, per trip, not inferred.
3. **Where the page lives.** Whether this is `/<user>/trips` answering
   differently for an anonymous reader, or its own address. Reusing the
   existing page means every reading path there has to be right for a reader
   with no grant at all.

Explicitly not in scope: any change to what a *guest* or a *person on the trip*
sees, and any new way to reach a day.

## Acceptance

- An owner of a `guest` journal can mark specific photographs and specific
  trips as part of a public portfolio, and nothing else becomes reachable.
- An anonymous reader sees those photographs and those trip cards (cover,
  dates, duration) and cannot open a day, a gallery item, or a trip page that
  was not offered.
- A trip not offered is absent — not a locked card, not a title.
- A test asserts that a portfolio entry cannot widen a trip's or an item's
  existing gate: removing the trip from the portfolio removes the picture.
- Decision 1 above is answered in the ticket before any code is written.
