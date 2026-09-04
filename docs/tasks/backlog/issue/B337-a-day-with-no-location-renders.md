---
id: B337
title: A day with no location: renders a blank, unlabelled filter chip in the gallery
type: ISSUE
priority: low
complexity: low
area: gallery
found: "2026-09-04T19:18:45Z"
---

# B337 — A day with no `location:` renders a blank, unlabelled filter chip in the gallery

## Why

Reported 2026-09-04 with a screenshot of `fernscout.ch/viki` — the gallery's
filter row shows `Alle (9)` followed by an empty white pill. It is clickable,
it filters, and it says nothing about what it filters to.

`components/GalleryGrid.tsx:29`:

```ts
const places = useMemo(() => Array.from(new Set(media.map((m) => m.location))), [media]);
```

`MediaTile.location` is `entry.location` copied straight through by
`getAllMedia` (`lib/entries.ts:399`), and `location:` is optional in an entry's
frontmatter — an entry without one parses to `""`. That empty string survives
into `places` and line 79-81 renders it as a chip whose only child is `{p}`,
which is nothing.

Cosmetically it is a blank pill. Functionally it is worse: it is the only way
to select those photos and it is unlabelled, so a reader has to click an empty
button to find out what it does.

The journals that hit this are the ones agents wrote without asking for a
location — the same population as B265 and B267 — but the guard belongs here
regardless, because `location:` is genuinely optional and always will be.

## Work

- Drop falsy locations when building `places`. One `.filter(Boolean)` at
  `components/GalleryGrid.tsx:29`.
- The photos themselves must stay in `Alle` — the count on that chip is
  `media.length` and has to keep including them. Only the per-place chip goes.
- Consider whether an unlocated group deserves a *labelled* chip instead
  (`gallery.noPlace`, needing a string in every locale). Cheapest correct thing
  is to drop it; say so in the diff if that is the choice, so the next reader
  knows it was decided rather than missed.
- Check the same pattern at the other place that groups by a possibly-empty
  entry field before calling this done.

## Acceptance

- A trip where some entries have no `location:` shows no blank chip, and
  `Alle (n)` still counts every photo including those.
- A trip where every entry has a `location:` is unchanged.
- A test on `GalleryGrid` with a mixed `media` array asserting the chip labels.
- `npm run verify`.
