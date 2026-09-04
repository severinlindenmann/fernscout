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

## Work

**Reproduce it signed in, in a real browser, before changing anything.** `curl`
has already been exhausted — it cannot hold a session and every server path
reads correctly. `chrome-devtools` is the tool AGENTS.md names for exactly this
("a page is wrong and `curl` says nothing"): sign in as the owner, open
`/viki#day-hanoi`, and look at the network panel.

What the answer looks like in each case:

- **Nine requests, all 200** → nothing is broken; the images below the fold
  had not loaded yet. Close this, and consider whether an anchor jump should
  eagerly load what it lands on — a separate, smaller question.
- **Nine requests, some 404 or 403** → the media route is refusing some days.
  Compare the failing day slugs against the entry slugs; a mismatch between a
  media folder name and its entry's slug would do it, and `attachGallery`
  chooses that folder.
- **Fewer than nine requests** → the page did not render the tiles, and the
  bug is in the story path after all, despite reading correctly. Look at what
  `buildStoryProps` returns for a draft day with a gallery.

Do not fix on the strength of the hypothesis above. The number three is the
clue and it has already misled once: B318's report also said three, and there
the explanation was three genuinely-published photographs, not a cap.

## Acceptance

Either an owner sees all nine photographs of their draft days on the story
page, or the ticket records — with the network evidence — that they always did
and what the owner was seeing instead.
