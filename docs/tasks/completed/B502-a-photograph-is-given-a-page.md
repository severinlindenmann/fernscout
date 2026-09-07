---
id: B502
title: A photograph is given a page it has not the pixels to fill
type: FEATURE
priority: medium
complexity: medium
area: photobook, print
found: "2026-09-05T17:05:25Z"
started: "2026-09-06T14:20:15Z"
merged: "2026-09-06T14:35:01Z"
completed: "2026-09-07T13:11:27Z"
---

# B502 — A photograph is given a page it has not the pixels to fill

## Why

The planner chooses a slot from a photograph's *shape* and never from its
*size*. `groupPhotos` asks whether a picture is portrait, landscape or a
panorama; nothing asks whether it has the pixels for the page it is about to
be given.

So a 1067px photograph can be handed a full-bleed 324mm page, which needs
3826px, and print at 93 DPI. The planner then warns about the thing it just
decided to do — `checkResolution` in `lib/photobook/plan.ts` reports it, and
the reader is told their book will be soft rather than being handed a book that
is not.

The warning is the right last line of defence and should stay. But a book has
somewhere better to put that photograph: the same picture in a quarter-page
grid slot at 72mm needs only 850px and prints sharp.

Found while fixing B496's rhythm, where heroes became deliberate rather than
automatic — which makes *which* photograph gets the big page a decision the
planner is now actually making.

## Work

Give `groupPhotos` and the hero choice a resolution floor: a photograph may
only take a slot it can fill at some fraction of the target DPI. Decide that
fraction — 300 is the target, 200 is a defensible floor for a full page, and
150 is where most people stop noticing at arm's length. Write down which and
why, because it is the whole of this ticket.

Consequences to think through rather than discover:

- A trip whose photographs are *all* small then has no hero at all. Is a book
  of grid pages better than a book of soft full pages? Probably, but say so.
- Page count moves, and so does the price.
- `expandToMinimum` breaks pages apart to reach the binder's minimum, which
  pushes photographs into *larger* slots — the two rules can fight, and this
  one should win.

**Not doing:** removing or quietening the warning. It is what catches the case
this cannot: a photograph that is soft even in the slot it was given.

## Acceptance

- A photograph below the floor is never given a full-bleed or feature page
  while a grid slot is available.
- The low-resolution warning still fires for a photograph that is soft in the
  slot it did get.
- A book of entirely small photographs still plans, still binds, and says in a
  warning that it had nothing big enough to run large.

## Done

Built in `.claude/worktrees/b502-photo-resolution`.

**The floor:** `HERO_FLOOR_DPI = 200` in `lib/photobook/spec.ts:246` (a named,
tunable constant beside `requiredPixels`/`effectiveDpi`, exactly as asked —
300 (`spec.dpi`) stays the print target, 200 is where a full page is judged
defensible). 150 (the "arm's length" number from the Work section) was not
used: nothing in this codebase needed two floors, and a single number that is
"a defensible floor for a full page" already answers the one question the
planner has to ask before *offering* a slot. `checkResolution` is untouched
and keeps using `spec.dpi` (300) for the after-the-fact warning — the floor
only gates which slot a photo is *offered*, never what a placed photo is
warned about.

**Where the floor applies** (`lib/photobook/plan.ts`):
- `fillsAFullPage(photo, spec)` (line 528) — checked against `spec.size
  .trimWidthMm`, not the exact slot geometry. `feature` stops at the gutter and
  is therefore narrower than the trim; using the trim width everywhere is
  intentionally the conservative (stricter) approximation, and the exact,
  final number is still `checkResolution`'s job once a placement exists.
- `groupPhotos` (line 758, now takes `spec`) — a lone photograph with no
  group to join used to always run `feature` (full-bleed to the outer edge).
  Now it only does when `fillsAFullPage`; otherwise it gets the layout named
  `single` (line 796) — defined in the `PhotoLayout` union and in
  `slotsFor`/`render.ts` since before this ticket, but never actually
  produced until now. It fits inside the content box (`contain`, not
  `cover`), which is a materially smaller printed width.
- The hero pick in `draftsForChapter` (lines 1024-1052) — `layout: "hero"`
  (an owner's explicit per-day override) is honoured regardless, same as
  every other named layout overruling the automatic rhythm. The *automatic*
  rhythm (`dayIndex === 0 || dayIndex % 3 === 0`) now skips a candidate that
  fails the floor and looks for another photograph of the day that clears it
  before giving up the hero page for that day entirely.
- `layoutFor` (line 1219; used by `expandToMinimum` to split a group when
  padding a short book to the binder's minimum) got the same floor-aware
  check, which is what settles the "the two rules can fight" consequence:
  splitting a group makes each half *smaller*, so a floor-aware `layoutFor`
  naturally never hands a photograph a full page as a side effect of
  padding.
- A trip where *nothing* qualifies: `planBook` (lines 1938-1946) checks,
  once, whether any `"photos"` draft in the whole trip ended up
  `full-bleed` or `feature`; if the trip has photographs and none did, it
  pushes one warning saying so.

**That last warning got its own code, not a reuse of `low-resolution`.** The
first attempt reused `code: "low-resolution"` and broke two existing tests —
`.find`/`[0]` picked up the new book-level warning instead of the per-photo
one they meant to check, because both now share the code. Worse: the shipped
`photobook.warn.lowResolution` string says "N photographs will print softly at
this size", which would have been actively false here — the whole point of
the floor is that these photographs *don't* print softly, they print smaller.
So this is `code: "no-large-photo"`, a new `BookWarning` code, with its own
`photobook.warn.noLargePhoto` string in all three shipped locales
(`site/locales/{en,de,hu}.json`), added to `WARNING_TEXT` in
`BookLevelView.tsx`, regenerated into `TranslationKey`
(`npm run i18n:keys`), and folded into the existing "try a smaller page" fix
button's condition — switching to `square-210` lowers `trimWidthMm` and
therefore the floor, so it is a genuine remedy here too, same as it already is
for `low-resolution`/`no-original`.

**Test:** `test/photobook.test.ts` — `groupPhotos` gets two direct cases
(a lone small photo downgrades to `single`, a lone large one still gets
`feature`), plus `planBook`-level tests: the automatic hero skips a too-small
candidate and finds a qualifying one further down the day's photos, and a
trip where nothing qualifies still binds, never produces a `full-bleed`/
`feature` page, and carries the `no-large-photo` warning. All fail against
`main` (`groupPhotos`/`layoutFor`/`expandToMinimum` need the new `spec`
parameter, and the warning code does not exist there) and pass here.

**`npm run verify` (full, not `--quick`):** build, `tsc --noEmit`, `eslint`
(12 pre-existing warnings, 0 errors, none introduced by this change), and
`vitest run` — 284 files, 3687 tests passed, 3 skipped (the Postgres-only
suite, no local Postgres) — all green, ~114s total.

No backlog captures — nothing found outside this ticket's scope.
