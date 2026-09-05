---
id: B493
title: A trip title with no spaces in it scrolls the home page sideways
type: ISSUE
priority: high
complexity: low
area: home view
found: 2026-09-05T00:00:00Z
merged: "2026-09-05T15:55:18Z"
---

## Why

A trip in `/xydhd-quiet` is titled with about three hundred `x` characters and
no space. On `/` the journal card renders it as a link in a `flex-wrap` list,
which cannot wrap a single word — so the card, the list and the page grow to
the width of the title and the whole document scrolls horizontally. Every other
card on the page is dragged along with it.

The title comes out of somebody's `trip.md`, so this is untrusted-length
content on a page that renders every journal on the instance. It is worse for
the operator than for anybody else: their list is the one that contains
journals they did not write.

## Work

`components/HomeJournals.tsx`. The trip links get a width they cannot exceed
and an ellipsis; the journal title and tagline get `break-words`, since the
same input can arrive there. No truncation of the *data* — the card is a
summary and the trip page shows the title in full.

## Acceptance

A trip titled with 300 unbroken characters: `/` does not scroll horizontally at
360px or at 1440px, and the card is the same width as its neighbours.
`test/home-long-titles.test.tsx` asserts the classes that hold that, since a
layout cannot be asserted in jsdom.
