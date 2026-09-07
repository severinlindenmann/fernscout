---
id: B664
title: The owner cannot see what is using their storage, or reclaim any of it
type: FEATURE
priority: medium
complexity: medium
area: me-page, storage
found: "2026-09-07T07:39:31Z"
started: "2026-09-07T07:53:47Z"
session: 52155fa5-6d95-440e-9de1-0e41d34e7f3d
claimed: "2026-09-07T07:53:47Z"
---

# B664 — The owner cannot see what is using their storage, or reclaim any of it

## Why

B661 gave a journal a ceiling, a warning mail and a way to buy more room. What
it did not give is the two things somebody actually does when they are told
they are nearly full: **look at what is taking the space**, and **get some of
it back**.

The `/[user]/me` page shows one line — used of allowed — which is the number
the mail already told them. There is nothing that says *the Alps trip is four
gigabytes and the photobook previews are one*, so the only lever an owner has
is the one that costs money. That is the wrong shape: a journal is usually
full of things nobody wants — half a dozen photobook PDFs generated while
choosing a layout, postcard previews of cards that were sent months ago — and
those should be a button, not a purchase.

## Work

**A Storage section on `/[user]/me`**, its own card rather than a line inside
Payment: it is about the journal and not about credits, and it has to be there
when credits are off (an owner still wants to know they are nearly full — the
buy button is what is absent then, not the figure).

- Used of allowed, and how much is left.
- **A breakdown**, one row per thing that holds bytes: each trip by name, the
  inbox (B663), photobooks, postcards. A small bar — the palette's, per
  `apply-the-brand` — because "which of these is the big one" is a question a
  chart answers in a glance and a table does not.
- The buy button from B661 moves here, where the number it acts on lives.

**A `GET /api/v1/<user>/storage` to feed it**, beside the existing `POST`: the
same breakdown, so an agent asked "why is this journal full" has an answer
without walking anything itself. One walk per call, cached for nothing — it is
the owner's own page and it must not lie about what is on disk.

**Cleanup, with the warning first.** One button, a confirmation that lists
exactly what will go and what will not, and then:

| Goes | Stays |
| --- | --- |
| Generated photobook PDFs | Every photograph they were built from |
| Postcard previews | Cards already sent, and their record |
| The inbox's unreferenced files (B663) | Anything a day or trip references |
| | Every published and draft day, and all trip media |

**Nothing that was printed or posted is touched**, and nothing a day points at
is touched — the check is what the content references, not how old a file is.
`lib/photobook/retention.ts` already prunes old orders by count and is the
place this logic belongs beside; this is the same idea with a person pressing
it.

The confirmation is not a dialog to click past: it says how many files and how
many megabytes, and it names the categories. An owner who has just been told
they are full is exactly the person most likely to press the first button they
see.

**Not doing:** any automatic cleanup, any schedule, any deletion of trip
media. The owner presses it or nothing happens.

## Acceptance

- `/[user]/me` shows Storage with used, allowed, remaining, and a per-trip
  breakdown that sums to the total the ceiling is measured against.
- The card is there with credits switched off; only the buy button is absent.
- `GET /api/v1/<user>/storage` returns the same numbers the page renders.
- Cleanup removes generated photobook PDFs and postcard previews, and a test
  asserts an order that was actually printed keeps its files and its row.
- Cleanup removes nothing a day or trip references, asserted by a test that
  puts a referenced file in the inbox and finds it afterwards.
- The confirmation names the categories and the reclaimable size before
  anything is deleted.
- `npm run verify` passes; the route is in `/openapi.json`.
