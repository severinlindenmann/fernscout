---
id: B75
title: An owner with no trips is told to ask whoever sent them here for an invitation
type: ISSUE
priority: medium
complexity: low
area: me, i18n, viewer
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
---

# B75 — An owner with no trips is told to ask whoever sent them here for an invitation

## Why

Found on 2026-09-01, signed in as the owner of a journal that had no trips in
it yet. `/<user>/me` read:

> **Dein Zugang**
> Angemeldet als test1@severin.io
>
> **Was du lesen kannst**
> Noch nichts. Bitte die Person, die dich hergeschickt hat, dich einzuladen.

Nobody sent the owner here. It is their journal, there is no such person, and
there is nothing they could be invited to that they do not already have.

The empty state is one string with one audience.
`app/[user]/me/MePageContent.tsx:107–108` branches on
`viewer.trips.length === 0` and prints `me.nothing`
(`content/locales/de.json:313`), which is written entirely for a guest whose
invitation has not arrived. `resolveViewer` (`lib/viewer.ts:66–82`) puts every
trip in the journal into `viewer.trips` for an owner — `if (owner ||
isPersonOn(trip, email))` — so for an owner the list is empty in exactly one
case: **the journal has no trips.** The panel has the information it needs to
say so and does not use it; `viewer.owner` is already on the object and is
already read further down the same file (`:142`).

The page's own docblock (`:14–24`) says it is written for "the reader least
comfortable with software on the site" and that "every line answers a question
she would actually ask". This line answers a question the owner did not ask,
with advice they cannot act on, at the first moment they look at their own
journal.

## Work

Split the empty state on `viewer.owner`. For an owner with no trips, say that
the journal has no trips yet and point at how one gets made — which, per
ROADMAP decision 24, is an agent, and the agent handover details (the
documentation URL and the owner's address) are already on this very page in
the owner block just below. A line and a new translation key in all three
locales; `me.nothing` keeps its present wording for guests.

Consider also the owner whose trips exist but are all drafts or otherwise
invisible — `resolveViewer` lists trips from `getTrips`, which does not filter
on draft state, so this should not arise, but it is worth confirming rather
than assuming.

**Confirmed.** A trip has no draft state to filter on: `draft` is a property of
an *entry*, set in its frontmatter and filtered in `lib/entries.ts`, and a
trip's own `status` is only `current`/`upcoming`/`past` (`lib/trips.ts:141`).
`getTrips` (`lib/trips.ts:376`) reads every folder under `<user>/trips/`,
sorts, and filters nothing on visibility, listing or `test:` — a `test: true`
trip is kept out of the feed, the search index and the sitemap, and is still in
this list. So for an owner the list is empty exactly when the folder is.

One case is not "invisible" but is worth writing down: `readTrip`
(`lib/trips.ts:288`) returns `null` for a `trip.md` whose `id` does not match
its folder, which is missing a title or ISO dates, or whose frontmatter will
not parse. Such a folder exists and is not counted, so the owner would be told
the journal has no trips. That is a broken trip rather than a hidden one — each
case logs a `[trips]` warning — and telling the owner about it belongs on the
trip list (B76) rather than here.

Not in scope: the trip list's own empty state on `/<user>/trips` — that is
**B76**. Related: **B44**, on what a *guest* sees when they arrive without
their link, which is the other half of this page's audience problem.

## Acceptance

- An owner of a journal with no trips sees an empty state that does not mention
  being invited by anybody.
- A guest with no readable trips still sees `me.nothing` unchanged.
- Both strings present in `de`, `en` and `hu`; `npx vitest run` green, including
  `test/locales.test.ts`.

## Built

`me.ownerNoTrips`, a second empty state chosen on `viewer.owner` at
`app/[user]/me/MePageContent.tsx:107–125`. `me.nothing` is untouched and still
what a guest with nothing to read sees.

The copy answers the heading's question first, then says how a trip is made,
then points *down the page* rather than repeating the handover — the
documentation URL and the owner's address are already in the owner block below
it, on the same screen and behind the same `viewer.owner` condition, so there
is one copy of them and no second thing to keep in step.

- **de** — Noch nichts — in diesem Tagebuch gibt es bisher keine Reise. Eine
  neue Reise schreibt ein Agent; die zwei Zeilen, die er dafür braucht, stehen
  weiter unten auf dieser Seite.
- **en** — Nothing yet — there are no trips in this journal so far. A new trip
  is written by an agent; the two lines it needs are further down this page.
- **hu** — Még semmi — ebben a naplóban egyelőre nincs út. Új utat egy ügynök
  ír; a két sor, amire ehhez szüksége van, lejjebb található ezen az oldalon.

`test/access-panel-empty.test.tsx` is the account of it: the owner's line in
all three maintained locales, the guest's line unchanged in all three, and —
because the copy points at something rather than saying it — that what it
points at is on the page it is shown on. Three of its four tests fail against
the old component and pass against the new one; the guest test passes against
both, which is the point of it.

It is its own file rather than a fourth `describe` in `test/access-panel.test.tsx`
because that file is explicitly about what the panel offers a **stranger** —
somebody with no session at all — and this is about two readers who are signed
in.
