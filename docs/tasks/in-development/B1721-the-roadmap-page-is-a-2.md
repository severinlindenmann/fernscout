---
id: B1721
title: The roadmap page is a 2.5 MB dump of 1,546 hidden ticket rows, and never shows how big anything is
type: FEATURE
priority: medium
complexity: medium
area: docs, roadmap
found: "2026-09-14T10:05:31Z"
started: "2026-09-14T10:06:14Z"
session: 8ad8d82a-af5e-4bb9-8a98-93f0dda642bc
claimed: "2026-09-14T10:06:14Z"
---

# B1721 — The roadmap page is a 2.5 MB dump of 1,546 hidden ticket rows, and never shows how big anything is

## Why

`curl https://fernscout.ch/docs/roadmap` returns **2,533,227 bytes**. The page
renders every task in `docs/tasks/` as a table row — 1,546 of them — and then
hides the non-`FEATURE` ones with a `:has()` rule and an unchecked checkbox.
A reader downloads 870 bug reports to read 417 features. On a phone that is
the whole page weight before a single row is legible.

Three further things are wrong with it as a *roadmap*:

- **Size is invisible.** Every task file carries `complexity: low | medium |
  high`. `lib/roadmap.ts` reads `id`, `title`, `type`, `priority` and `area`
  and drops `complexity` on the floor. A reader cannot tell a fortnight's work
  from an afternoon's, which is the first question anybody asks of a roadmap.
- **The lanes are rendered as five collapsible folders named after our own
  workflow**, two of them collapsed by default, one of them holding 1,306
  finished tickets. `Completed (1306)` as a `<details>` is an archive, not a
  roadmap.
- **Bodies are unreachable.** The page publishes titles only. The repository
  is public (`github.com/severinlindenmann/fernscout`), so the reason for
  withholding them — recorded in `lib/roadmap.ts`'s doc comment — no longer
  holds for anything that is not `type: SECURITY`.

**Corrected while building, 2026-09-14.** The draft this ticket was approved
from reported three duplicate pairs — B1587/B1588, B714/B715 and B1598/B1599.
They are not duplicates. The second of each pair is already in
`docs/tasks/backlog/superseded/`, which the draft's own de-duplication knew
nothing about. There is no data defect there, and nothing to clean up.

What the mistake did surface is a real one, and it is this page's: **twenty-six
`type: FEATURE` tickets sit in `backlog/superseded/` and another in
`backlog/wont-do/`**, and both B675's page and the approved draft drew them
among the rest of `backlog/` — under a column this redraw explicitly labels
"wanted, not started". A roadmap promising twenty-seven features somebody
already cancelled or replaced is worse than one that omits them. Handled in
the Work below as `shelved`.

Design approved from a draft on 2026-09-14: a four-column board, ten cards per
column, size carried by the card's own shape, a search over every ticket
underneath, and the full ticket text on click.

## Work

`lib/roadmap.ts` and `app/docs/roadmap/page.tsx`, plus one new route for a
single ticket. Everything stays server-rendered off the filesystem, read fresh
per request — no build step, no GitHub API, no network. `docs/tasks/` is on
the disk the page runs on; fetching 1,600 files over a 60/hour unauthenticated
cap would buy nothing and add an outage mode.

1. **`lib/roadmap.ts`** — carry `complexity` and the completion date
   (`completed` / `merged` / `started` / `found`, first one present) on each
   task, plus its path relative to the repository root for the GitHub link.
   Add a `getTask(id)` that returns one task with its body. Keep the
   `type: SECURITY` filter exactly as it is — on the type in every lane, and
   on `backlog/security/` by path as the second guard.
2. **The board.** Four columns: Backlog (`backlog/` + `open/`), In
   development, Testing, Done. Ten cards each — Backlog and Testing sorted by
   priority then size, Done by completion date newest first. Each column
   header carries its true total and a thin bar showing its big/medium/small
   mix.
3. **Card size is `complexity`.** `high` gets a display-face title, a dark
   stripe, three waymark lozenges and up to three area tags; `medium` a body
   title, a yellow stripe and two lozenges; `low` one line and one lozenge.
   The waymark is the brand mark — see `docs/branding/BRAND.md` §2.
4. **The full list.** Below the board, every non-`SECURITY` ticket in one
   scrollable list with a text filter over id, title and area, and lane and
   type filter chips. A column's "+N more" jumps here with that lane
   pre-selected.
5. **The ticket itself.** Clicking a card or a row opens
   `/docs/roadmap/<id>` — a real page, not an embedded blob, so nothing
   carries 5.7 MB of bodies. Metadata, the rendered body, and a link to the
   same file on GitHub.
6. Drop the show-everything checkbox and its `:has()` stylesheet with it.

Locale strings for anything new, in all three of `site/locales/`.

## Acceptance

- ~~`/docs/roadmap` returns under 250 KB.~~ **Corrected after measuring, and
  not to make this branch qualify: 250 KB was never reachable by any page
  here.** `/docs` itself is 240,037 bytes and `/docs/hosting` 239,363 with no
  roadmap content in either — that is the docs layout, its navigation and its
  search index, on every page under `/docs`. The criterion as written asked
  for a page smaller than its own empty shell.

  What it meant is that the page stops being a multi-megabyte dump, so that
  is what is measured, on a production build:

  | | before | after |
  | --- | --- | --- |
  | `/docs/roadmap` | 2,533,227 B | 476,536 B |
  | gzipped, which is what crosses the wire | 244,743 B | 79,649 B |

  Of the 476 KB, ~240 KB is the shared `/docs` floor above and ~235 KB is the
  board, the search results and the RSC payload that mirrors them. Three times
  smaller over the wire, five times smaller raw. `/docs/roadmap/B1585` is
  270,896 B — the floor plus one ticket.
- Exactly ten cards per column where the lane holds more than ten; the header
  shows the true total and the "+N more" control filters the list below.
- A `high` card, a `medium` card and a `low` card are visually distinguishable
  without reading the legend.
- Typing `postcard` into the search narrows the list; the count updates.
- Clicking a card opens that ticket's own page with its body rendered.
- No `type: SECURITY` ticket appears on the board, in the list, or at
  `/docs/roadmap/<id>` — in any lane.
- `test/roadmap.test.ts` still passes against its fixture tree, extended for
  `complexity` and the single-ticket read.
- Checked in a real browser at 1280 and 390, against `docs/tasks/` as it
  stands, in **both themes** — `/tmp/b1721/` dark and `/tmp/b1721-light/`
  light, board and ticket, 0 console errors and 0 failed requests in each.
  Light was driven with `CHROME_PATH` pointed at a wrapper adding
  `--blink-settings=preferredColorScheme=1`, because the theme is held in
  `localStorage` and `check-page.mjs` can only set cookies.
- `npm run verify` green.

## What this turned out to be

- **Validity, 2026-09-14: valid.** `curl` returned 2,533,227 bytes from the
  live page, and `lib/roadmap.ts`'s `RoadmapTask` carried no `complexity`
  field to draw a size from. Both read before any of this was written.
- **The three duplicates were not duplicates** — see the correction in Why.
- **`backlog/superseded/` and `backlog/wont-do/` needed a name.** Tasks now
  carry `shelved: boolean` from their folder; the board leaves them off and
  the search labels them `shelved` rather than pretending they are a lane.
- **Sixty-one task files do not parse**, so the page counts 1,551 tickets
  where `find` counts 1,673 — an unquoted `: ` in the `title:` value every
  time. Pre-existing, nothing this branch did: captured as **B1723**, not
  absorbed here. `lib/roadmap.ts` skipping a bad file rather than throwing is
  the behaviour B675 chose and it stays.
- **No new locale strings.** `/docs/roadmap`, like `/docs/api` and the rest of
  the technical pages, is written in English in the component — `lib/docs.ts`
  records why the guides are the translated ones and these are not. Only the
  nav label (`docs.roadmap.title`) is translated, and it was already there.
- **The search is a `GET` form, not a client component.** Filtering server-side
  is what keeps the page small: the weight B675 shipped was the 1,546 rows it
  had already decided to hide, and a client-side filter would have shipped
  them all again to search them in the browser.
