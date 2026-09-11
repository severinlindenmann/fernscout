---
id: B1442
title: A day started in the room is titled with its own date, so every surface shows an ISO date
type: ISSUE
priority: high
complexity: low
area: helper, room
found: "2026-09-11T11:10:53Z"
---

# B1442 — A day started in the room is titled with its own date, so every surface shows an ISO date

## Why

Found in a live owner session on fernscout.ch, 11 September 2026, while
converting B1296's verdict.

Pressing **Start this day** in the room writes the day with its own date as its
title. On disk:

```
/var/lib/fernscout/content/example/trips/usa-2026/entries/2026-09-11-2026-09-11.md
---
title: "2026-09-11"
date: "2026-09-11"
```

The slug carries the date twice and the title is a bare ISO string. Every
surface that renders a title then renders an ISO date: the room's own preview
card showed `2026-09-11` three times in one view — once as the preview header's
title, once as its subtitle, once as the day's `<h2>`.

That is the thing **B1296** exists to prevent. Its own changes are correct and
confirmed live — the trip cards name trips by title, the date spans read
"1 June – 20 November", no trip id appears anywhere — so this is a different
cause landing the same text on the screen: not prose that prints an id, but a
day whose title *is* one, written by the room a moment earlier.

It is also not only a helper problem. The title goes to disk, so it reaches the
day page, the feed, the search index and the sitemap if the day is ever
published.

## Work

Decide what an untitled day is called, and write that instead of the date. The
candidates, in the order they are cheap:

- No `title:` at all, and let each surface fall back to the formatted date it
  already knows how to render ("Friday, 11 September"). The field is optional
  elsewhere; check `lib/entries.ts` before assuming.
- A title the model proposes from the day's own notes at write-up time, which
  is what "Write it up for me" already does for the prose.

Also fix the slug: `2026-09-11-2026-09-11` is the date concatenated with a slug
derived from the same date.

Not in scope: B1296's own changes, which are verified correct.

## Acceptance

- A day started in the room and left untitled shows a readable date, not
  `2026-09-11`, in the room's preview card and on its own page.
- Its file is not named with its date twice.
- No ISO date appears in the helper room's prose or cards — B1296's line,
  re-checked against this path.
