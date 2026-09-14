---
id: B1718
title: A reader who finishes the demo journal has no way to start one of their own
type: FEATURE
priority: high
complexity: medium
area: journal pages
found: "2026-09-14T10:12:00Z"
started: "2026-09-14T09:48:30Z"
session: 68f03fd3-84f8-42b3-b482-61bfc4440340
claimed: "2026-09-14T09:48:30Z"
---

# B1718 — A reader who finishes the demo journal has no way to start one of their own

## Why

`/example` exists to convince somebody, and it is the one page on the
instance with no door out of it. A reader who follows the landing page into
the demo, reads a trip and reaches the end has to go back to the front page by
hand to do anything about it. The person most likely to sign up is the person
who just finished reading, and nothing meets them there.

## Work

Decided with the owner on 2026-09-14, from
https://claude.ai/code/artifact/77b0901d-e870-4014-9042-dd25f2f11154

**The flag is the operator's, and no API may write it.** `site.showcase`, a
list of usernames, in `site/config.json` — the block `lib/config.ts` parses at
boot and nothing under `app/api/` ever writes. Not a field in
`content/<user>/config.json`: that file is the journal owner's and is
reachable over the API, so an owner could switch an advert on for a journal
full of other people's photographs. Default `["example"]`, so a fresh clone
shows it on the demo and on nothing else, and a second showcase journal later
is one string.

**Present, not once.** The owner asked for something a reader can always get
back to, not only a band at the end:

- A bar that rises from the foot of the page once the reader is far enough
  in to have seen something — one sentence, one primary button, one quiet
  "how it works".
- Dismissible, and the dismissal sticks for that browser. A thing that cannot
  be closed is the pattern this brand has refused everywhere else.
- It animates in; `prefers-reduced-motion` gets it without the motion.
- It never covers the last line of the page — the content keeps its own room
  underneath.

Not `window.confirm`-style, not an overlay over the middle of somebody's
trip, and never on a journal that is not in `site.showcase`.

## Acceptance

- On `/example` the bar appears after scrolling into the page, and closing it
  keeps it closed on reload.
- On a journal not named in `site.showcase`, the bar is absent from the
  document — not hidden by CSS.
- No route under `app/api/` can add a username to `site.showcase`; a test
  asserts the field is read from the server config only.
- With `prefers-reduced-motion: reduce` it appears without animating.
- Nothing it covers is unreachable at 390 width, including the last element
  of a trip's story.
- Captured at 1280 and 390, on `/example` and on a journal without the flag.
  `npm run verify` passes.
