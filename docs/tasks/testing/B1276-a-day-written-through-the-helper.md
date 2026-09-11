---
id: B1276
title: A day written through the helper gets the date as its slug, so its address is fernscout.ch slash day slash 2026-09-05
type: ISSUE
priority: medium
complexity: low
area: helper, slugs
found: "2026-09-10T10:24:26Z"
started: "2026-09-11T08:42:18Z"
merged: "2026-09-11T10:01:17Z"
---

# B1276 — A day written through the helper gets the date as its slug, so its address is fernscout.ch slash day slash 2026-09-05

## Why

A day written end to end through `/agent` — describe it, have it written up,
publish it — lands on disk as

```
content/test-mobile/trips/bern-weekend-2026/entries/2026-09-05-2026-09-05.md
```

with `title: "Old town, bears, and Einstein"` inside it, and is served at

```
https://fernscout.ch/test-mobile/day/2026-09-05
```

The slug is the date a second time. AGENTS.md describes the file as
`YYYY-MM-DD-slug.md`; here the slug *is* the date, so the name carries one fact
twice and the day's own title reaches the URL nowhere.

The cause is the order the helper works in, and it is inherent to the flow rather
than a slip: the day is **started empty** — "It starts empty; the words and the
photographs come after" — so at the moment the file is named there is no title to
name it from. The title arrives one card later, at *Write it up for me*, and
nothing goes back.

Compare the demo journal, written by hand: `/example/day/oregon-coast`,
`/example/day/denver-and-a-truck`. A journal written through the product's own
door gets worse addresses than one written without it, and this is the address
that goes into an email to somebody's family and stays there.

It also collides in a way dates do not warn you about: several updates in one day
is stated in AGENTS.md as normal, and the second one cannot be `2026-09-05` too.

## Work

- Decide when a day gets its name. Naming it at the write-up, where the title
  first exists, is the obvious point; a rename at that moment must move the media
  directory (`media/<trip>/2026-09-05/`) with it, which is the real work here.
- If a rename is judged too expensive, the alternative is to not create the file
  until there is a title — but the empty-day card exists on purpose (B?), so
  that is a decision rather than a refactor.
- `lib/slug` already has the slugify this needs; note B77, which records that
  two slugify functions here disagree.

## Acceptance

- A day written through the helper and titled "Old town, bears, and Einstein" is
  reachable at a URL containing those words.
- Its photographs still resolve after the rename.
- Two days written on the same date both get usable, distinct addresses.
