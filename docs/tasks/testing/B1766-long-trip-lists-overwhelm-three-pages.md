---
id: B1766
title: Long trip lists overwhelm three pages: storage, what you can read, and the trips index
type: ISSUE
priority: medium
complexity: low
area: Account, me and trips pages
found: "2026-09-15T06:06:39Z"
started: "2026-09-15T06:06:50Z"
merged: "2026-09-15T06:21:08Z"
---

# B1766 — Long trip lists overwhelm three pages: storage, what you can read, and the trips index

## Why

A journal with many trips turns three owner-facing lists into a wall. On
`/<user>/account` the storage legend prints one row per trip; on `/<user>/me`
"What you can read" prints every readable trip; on `/<user>/trips` the cards
below the world map print every trip in the journal. Each is a scroll rather
than an answer.

Two more, asked for while this was being built: the trip switcher in the
header lists every past trip, so a nine-trip journal opens a menu that
scrolls; and the appearance panel on `/<user>/me` is a full card with a lede
for three buttons.

Revalidated: valid. Every list named here prints one row per trip today.

## Work

- Account storage legend: already sorted biggest first — cap the legend and the
  bar at the ten largest, with a "Show more" button revealing the rest.
- `/<user>/me`: order the readable trips newest first and show five, then the
  same "Show more".
- `/<user>/trips`: the world map keeps drawing every route; the cards below show
  the six newest, then "Show more".
- Trip switcher: four past trips, plus whichever one is being read; the
  "all trips" link at the foot is already the way to the rest.
- Appearance panel: one row — heading left, the three buttons right — and the
  lede dropped, its key removed from all three locales.
- One shared `common.showMore` string in en/de/hu.

## Acceptance

- Nothing is unreachable: every capped list reveals the rest in one press.
- The trips map still draws every visible route before and after the press.
- `npm run verify` passes; the pages check out in a browser at desktop and
  phone width.

## Done

Verified against the `example` journal at localhost, desktop 1280 and phone
390:

- `/example/trips` — six cards, "Show more" reveals the seventh; the map draws
  293 paths before and after the press, unchanged.
- `/example/me` — five rows plus "Show more"; the appearance panel is now a
  78px row rather than a card.
- The switcher's cap is not reachable on `example` (three past trips), so the
  slice is covered by `pastShown` in `test/trip-switcher.test.tsx` instead —
  four, the active one kept wherever it sits, a short list untouched.
- Storage legend caps at ten; `example` has eight trips, so the button does
  not appear there. Not exercised in a browser.
- Console errors on the trip page are the disabled reactions and helper
  capabilities, not this branch.
