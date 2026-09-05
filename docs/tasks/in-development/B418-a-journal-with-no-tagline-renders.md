---
id: B418
title: A journal with no tagline renders a dangling em-dash in its title and og:title
type: ISSUE
priority: low
complexity: low
area: i18n
found: "2026-09-05T08:31:29Z"
started: "2026-09-05T08:49:36Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T08:49:36Z"
---

# B418 — A journal with no tagline renders a dangling em-dash in its title and og:title

## Why

A journal created without a tagline renders both its `<title>` and its
`og:title` with the separator still in, followed by nothing:

```
<title>The Solo Journal —  · Fernscout</title>
<meta property="og:title" content="The Solo Journal —  · Fernscout">
```

Journals that have a tagline are fine — "The Quiet Journal — One journey, kept
back · Fernscout". Observed on fernscout.ch 2026-09-05 on a journal created
through `POST /api/v1/journals` with no `tagline` field, which the API accepts:
`tagline` is documented as optional.

So the default state of an optional field produces a broken title, in the two
strings that follow the journal everywhere — the browser tab, the bookmark, and
the card every chat app and search engine renders when the address is shared.

## Work

Join the parts that exist rather than interpolating a fixed separator: no
tagline, no dash. Check the same pattern for a trip with no tagline, which is
also optional.

## Acceptance

A journal with no tagline has a title of "<Journal> · Fernscout", and its
og:title matches.
