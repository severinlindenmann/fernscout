---
id: B34
title: A trip taken by two people appears in only one of their journals
type: FEATURE
priority: medium
complexity: high
area: trips, journals, access
found: "2026-09-01"
---

# B34 — A trip taken by two people appears in only one of their journals

## Why

Two people go to Vietnam together. Both have a journal on this instance. The
trip is written once, in one of them, and the other is listed in `people:` —
which, per `lib/tripPeople.ts`, lets them read it and write to it. Everything
about that is right and should not change: a shared trip written twice is two
divergent accounts of the same fortnight, and the `people:` model exists
precisely so it is written once.

What is missing is that the trip is invisible from the other side. `getTrips`
(`lib/trips.ts:342`) lists what is on disk under `content/<username>/trips/`,
and a trip in somebody else's folder is not there. So the buddy's own journal —
their landing page, their trip list, their archive — shows no sign of a
fortnight they were on. Somebody reading *their* journal sees a gap in the
timeline. They themselves have to remember whose journal it was filed under and
navigate there by hand.

The trip is already addressed in a way that makes this answerable. A ref is
`<username>/<trip-id>` (`tripRef`, `lib/trips.ts:27`), unique across the
instance, exactly because trip ids are not. So the buddy's journal can point at
the canonical copy without owning it.

This follows B33, which is what makes somebody a buddy through a link rather
than through a hand-edited file. Both want the same underlying answer to "which
trips does this person belong to, across the instance" — B41 for the gate, this
for the listing — so whatever B33 builds for membership is what this reads.

## Work

Make a trip somebody is on appear in *their* journal, marked as somebody
else's, pointing at the one copy.

- Resolve, for a username, the trips in other journals whose `people:` (or
  B33's grant equivalent) names their owner's address. One canonical helper,
  not a filter reimplemented per surface.
- Show them in that journal's listings labelled as shared, naming whose journal
  it lives in. A reader must never be misled into thinking this person wrote
  it — the trip is credited to the people on it, and the byline stays the
  canonical one.
- Link to the canonical URL. Decide, and record here, between two shapes:
  a plain outbound link to `/<owner>/trips/<id>`, or a stub route under the
  buddy's own journal that redirects there. The redirect keeps the buddy's
  journal as the single place they hand people, and survives the trip moving;
  the plain link is honest about where the content lives and costs nothing.
  Lean to the redirect only if a concrete reason appears — an extra route with
  its own access check is an extra place to get access wrong.

The things that will go wrong if not decided up front:

- **Access is the owner's, not the viewer's.** A shared trip listed in the
  buddy's journal must be gated by the *canonical* trip's `visibility`, in the
  *owner's* journal. A stranger reading the buddy's journal must not see a
  `private` trip's title, dates or route in a listing. `mayReadTrip` already
  takes the trip and decides; the risk is a listing that filters on the wrong
  journal's rules. This is the same class of leak `lib/tripGate.ts` documents
  at the top — data serialised into the RSC payload by a page that rendered
  anyway.
- **Whose feed, sitemap and search?** A shared trip must not be indexed twice
  under two URLs, must not appear twice in one search index, and probably does
  not belong in the buddy's `sitemap.xml` or RSS at all. Say so explicitly per
  surface rather than letting each one inherit an accident.
- **Consent runs both ways.** Being named in somebody's `people:` currently
  grants access; it would now also publish a row in your journal that you did
  not write. Decide whether appearing is automatic or opt-in, per trip or per
  journal, and where that switch lives. Automatic is defensible — you were on
  the trip — but it means anyone can put a line in your journal by typing your
  address into their frontmatter, and that should be a decision rather than a
  side effect.
- **Cross-journal is not cross-instance.** This is trips in other journals on
  the same instance. Federation is not this task and should not be designed
  into it.

Not doing: copying, mirroring or syncing any content. There is one trip, in one
folder, owned by one person. Also not doing: letting a buddy's journal change
how the trip renders — no per-journal titles, ordering or covers.

## Acceptance

- A trip in journal A naming B's owner address appears in B's trip listing,
  labelled as shared and naming A.
- Following it reaches the canonical trip and it reads normally for B.
- An anonymous visitor to B's journal sees a `private` shared trip nowhere —
  not in the listing, not in metadata, not in the RSC payload — asserted by a
  test that greps the rendered response, in the shape `lib/tripGate.ts`
  describes.
- A `guest` shared trip follows the canonical journal's gate, not B's.
- The trip appears once across feed, search index and sitemap, and the task
  file records which journal owns each.
- The consent decision is written in this file, and matches what ships.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
