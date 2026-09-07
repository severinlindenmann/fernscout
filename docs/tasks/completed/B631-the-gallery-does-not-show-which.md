---
id: B631
title: The gallery does not show which photographs are held back
type: FEATURE
priority: medium
complexity: low
area: gallery, photo visibility
found: "2026-09-06T17:51:44Z"
started: "2026-09-06T18:39:47Z"
merged: "2026-09-06T18:51:32Z"
completed: "2026-09-07T13:12:37Z"
---

# B631 — The gallery does not show which photographs are held back

## Why

B596 gave a gallery item its own `visibility:` — `guest` or `private`, always
narrowing — and it works: `visible()` strips the item and the media route
refuses the file. What is missing is the owner's own view. Looking at a gallery
as the owner, every photograph looks alike, so there is no way to check that
the one picture meant to be held back actually is. A visibility feature nobody
can see the state of is a feature nobody trusts.

## Work

- To a reader who is the owner or on the trip, mark a photograph that carries a
  `visibility:` — small, unobtrusive, and only where the label exists.
- Nothing changes for anyone else: an ordinary reader sees no marker, because
  they see no held-back photograph at all.
- Add held-back photographs to the example journal so this can be looked at —
  a few pictures on `/example`, some `guest`, some `private`. That is also what
  demonstrates B596 to somebody reading the demo.

## Acceptance

- As the owner, a `guest` and a `private` photograph on `/example` are visibly
  distinguishable from an unlabelled one.
- Signed out, `/example` shows neither the markers nor the photographs.

## Findings

`visibility` did **not** survive the read layer into the gallery grid. It
survives fine in `GalleryItem` (`lib/types.ts`) and therefore in `entry.gallery`
— `visible()` in `lib/entries.ts:216` only filters the array, it never strips
fields off an item it keeps, so the day page's `Gallery` component
(`components/Gallery.tsx`, fed straight from `entry.gallery`) already had the
field. `getAllMedia` (`lib/entries.ts:503`) did not: it projects each
`GalleryItem` down to a `MediaTile` and the projection list simply never named
`visibility`, so `GalleryGrid` (both trip-gallery pages) never saw it. Fixed by
adding `visibility?: PhotoVisibility` to `MediaTile` (`lib/types.ts:98`) and to
the projection (`lib/entries.ts:517`).

The reader's own level (`ReaderLevel`, already computed by `readFor` for every
page that needs one) was not threaded to any client component at all. Added it
to `TripProvider`'s context (`components/TripProvider.tsx`) alongside
`canPublish` — same shape of problem, same fix the code already used once.
Six page.tsx files that render a gallery or the day story now pass
`reader={read.reader}`: `app/[user]/(trip)/page.tsx`,
`app/[user]/(trip)/day/[slug]/page.tsx`, `app/[user]/(trip)/gallery/page.tsx`,
`app/[user]/trips/[trip]/page.tsx`, `app/[user]/trips/[trip]/day/[slug]/page.tsx`,
`app/[user]/trips/[trip]/gallery/page.tsx`.

New `components/PhotoVisibilityBadge.tsx` renders nothing unless
`reader === "person"` (owner or somebody on the trip) *and* the item carries a
`visibility` — never for a `guest`-level reader, even one who may read a
`guest` photograph, matching the ticket's "owner or on the trip" wording. It is
wired into both photo grids: `components/GalleryGrid.tsx` (trip gallery
pages) and `components/Gallery.tsx` (the day page's polaroid grid), each
reading `reader` off `useTrip()` rather than a new prop, to avoid drilling it
through `StoryPager` → `DayCard` → `UpdateBlock` a second time.

Example content: `content/example/trips/usa-2026/entries/2026-06-19-utah-red-country.md`
photo 03 is now `visibility: guest`, and
`content/example/trips/usa-2026/entries/2026-08-24-oregon-coast.md` photo 04 is
`visibility: private`. `usa-2026` is the current trip (shown bare at
`/example`), and already `visibility: public`, so both cases are reachable at
the site's front door.

Signed out (`curl http://localhost:.../example` and `/example/gallery`),
neither `oregon-coast/04.jpg` nor `utah-red-country/03.jpg` appears anywhere in
the HTML — confirmed by grep, not just by eye. Could not sign in as the owner
through a browser in this environment (no mail transport to read a code from),
so the owner path is demonstrated by `test/photo-visibility-marker.test.tsx`
instead: it builds a two-photo fixture (one plain, one `private`), renders
`GalleryGrid` through `getAllMedia` at `reader: "public"` (photograph and
"Private" text both absent) and at `reader: "person"` (photograph present,
exactly one "Private" marker).

Locale strings added: `photo.visibilityGuest` / `photo.visibilityPrivate` in
`site/locales/{en,de,hu}.json`, and the matching entries in the
`TranslationKey` union in `lib/i18n.ts` (required by `test/locales.test.ts`).

`npm run verify`: build, tsc, eslint (0 errors, pre-existing warnings only),
and `npx vitest run` — 304 files, 3919 passed, 3 skipped (Postgres tests, no
local Postgres) — all green.
