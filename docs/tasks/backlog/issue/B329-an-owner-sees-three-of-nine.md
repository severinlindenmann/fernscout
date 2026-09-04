---
id: B329
title: An owner sees three of nine photographs on the story page and the server path is correct
type: ISSUE
priority: high
complexity: medium
area: media, viewer
found: "2026-09-04T18:41:32Z"
---

# B329 — An owner sees three of nine photographs on the story page and the server path is correct

## Why

Reported twice by the owner, 2026-09-04, the second time after B318 shipped:
*"for some reason I only see like 3 images on the drafts of the 9 images I
uploaded, but after publish I normally then see them."* Named the two days
whose images did appear — `#day-hanoi` and `#day-hanoi-nachtleben` — which are
the last two of fifteen, and are where the anchor in the URL lands.

**Everything on disk is complete.** Verified on the server:

- 9 gallery items across 8 entries (`2025-11-02-bangkok` has two, the rest one
  each), all fifteen days `status: draft`.
- 9 derivative files under `trips/asien-2025/media/`, one folder per day slug,
  each folder's name matching its entry's slug exactly.

**And every server path checked is correct.** This is why the ticket exists
rather than a fix:

- `app/[user]/(trip)/page.tsx:28` passes `includeDrafts: await isOwner(user)`,
  and `lib/tripView.ts` threads it through `buildStoryProps` to `getDays`.
- `app/[user]/media/[...path]/route.ts` withholds a draft day's media only
  when the viewer is not the owner (`isDraftDay`, using
  `getEntryBySlug(..., { includeDrafts: true })`).
- B318 fixed the two **gallery** pages, which are not this page. The story
  page was already right.

An unauthenticated request 404s on every one of the nine media URLs, including
the two the owner *can* see — which is correct, and which also means the
difference cannot be reproduced without a session. Note that a viewer who was
not recognised as the owner would see **no** draft days at all, and the owner
sees them, so `isOwner` is resolving true.

**Leading hypothesis, unproven: this is client-side, not server-side.** Images
lazy-load, and the owner arrived via `#day-hanoi` — so the images at and near
the anchor are exactly the ones that would have loaded. "After publish I
normally then see them" is equally consistent with having scrolled further on
the second look. If that is what this is, it is not a bug about drafts at all;
it is that a fifteen-day story page loads its photographs on scroll and an
anchor jump makes that visible.

## Resolved — not a defect

**Confirmed by the owner on 2026-09-04: the photographs appear after a while.**
Nothing is broken, and the mechanism is `STORY_WINDOW`.

`lib/tripView.ts:15` sets `STORY_WINDOW = 2`, and `windowFor` (line 81) clamps
a window of two days either side of a centre — **five days**, not fifteen.
`buildStoryProps` slices `days` to that window and the reader fetches the rest
from `/<user>/story.json` as they move. The centre is `openAt ?? getDefaultDay`,
and for a trip that ended in the past the default day is at the end — so the
opening window on `viki/asien-2025` is 2025-11-13 to 11-15, of which exactly
**two days carry galleries**: `hanoi` and `hanoi-nachtleben`. That is the whole
of the report.

So the count was never about drafts. Everything the earlier investigation
confirmed still holds and is worth keeping: 9 gallery items, 9 derivatives on
disk, the story page passing `includeDrafts: await isOwner(user)`, the media
route withholding a draft's images only from non-owners, and B318 having fixed
the two *gallery* pages, which are not this page.

"After publish I normally then see them" was scrolling, not publishing.

## What is left, and it is small

**A fragment cannot centre the window.** The owner's link was
`/viki#day-hanoi-nachtleben`. A `#fragment` never reaches the server, so
`openAt` is undefined and the window opens on the default day regardless of
which day the link names. When the linked day happens to fall outside the
opening window, following the link scrolls to an anchor that is not rendered
yet — the reader lands on nothing until the loader catches up.

That is a real, if minor, defect in sharing a link to a particular day. The fix
is a query parameter rather than a fragment — `?day=<slug>` or `?on=<date>`,
which `openAt` already accepts — plus whatever writes those links choosing the
former. Check what currently generates `#day-<slug>` hrefs before deciding; if
they are only ever in-page navigation within an already-loaded story, there is
nothing to fix and this task closes with the paragraph above as its record.

Also worth one measurement, not a change: how long "a while" is. Five days of
prose plus a `story.json` round trip per step is the design, and if the first
window takes noticeably long on a fifteen-day trip that is a performance
question, not this one.

## Acceptance

Either a link naming a day opens the story on that day, or it is established
that no shared link ever names one and this task closes as the record of why
three of nine photographs was correct behaviour.
