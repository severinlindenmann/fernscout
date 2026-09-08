---
id: B915
title: A photograph in the inbox cannot be put on a day from a browser
type: FEATURE
priority: high
complexity: medium
area: agent, media, inbox
found: "2026-09-08T06:33:57Z"
---

# B915 — A photograph in the inbox cannot be put on a day from a browser

## Why

The files pane (B902) lets a person tick photographs in the inbox and say "put
these on yesterday". The sentence is understood, the selection is resolved
against disk and handed to the model in words — and then it ends in a **link**
to the day's own page, because there is no route that can do it.

`app/api/v1/[user]/trips/[trip]/media/route.ts:224` attaches media to a day and
takes a **bearer token only**. `app/api/helper/[user]/day/media/route.ts`
uploads bytes from a browser and cannot take a file that is already staged.

So the one sentence the files pane exists for is the one it cannot finish. And
it is the last link in a chain that has been built and unreachable since B689:
a statement or an export could not be *chosen* until B791 widened the picker,
and a photograph in the inbox still cannot be *used*.

Found while building the room, 2026-09-08, and reported honestly as "the work,
not the room".

## Work

A cookie-only helper route that attaches an already-staged inbox item to a day
— the same guard shape as every other `/api/helper/` route, calling the same
`attachGallery` the v1 route calls, so there is one implementation.

Then an `attach_files` **write** tool: it proposes, naming the photographs and
the day, and writes on the press like every other write. That turns the pane's
own sentence into a proposal instead of a link.

Two things to keep: the inbox names files by a hash of their bytes, so
attaching the same file twice must be recognised rather than duplicated; and an
item that leaves the inbox for a day should stop being offered in the pane.

## Acceptance

Ticking two photographs in the inbox and saying "put these on yesterday"
produces a proposal, and pressing it puts them on the day.
