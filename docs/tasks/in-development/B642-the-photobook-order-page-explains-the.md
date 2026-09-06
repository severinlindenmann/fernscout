---
id: B642
title: The photobook order page explains the spine, the soft prints and the extras badly
type: DOCS
priority: medium
complexity: low
area: photobook, order page
found: "2026-09-06T17:51:57Z"
started: "2026-09-06T18:39:46Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T18:39:46Z"
---

# B642 — The photobook order page explains the spine, the soft prints and the extras badly

## Why

Three things the photobook order page says, or fails to say, to somebody who
has not read the code.

**The spine is a surprise.** A printed book carries the trip's title on its
spine, and the page never mentions it. The first time an owner learns what is
printed down the edge of their book is when it arrives.

**The warnings are written from the inside.** `photobook.warn.heading` is "Gut
zu wissen, bevor du bestellst" and `photobook.warn.lowResolution`
(`site/locales/de.json:749`) is "9 Fotos werden in dieser Grösse weich gedruckt
— sie haben weniger Pixel, als die Seite braucht." That is accurate and it is
not usable: it does not say which nine, whether that is bad, or what the person
could do about it.

**The extras are off when they would be welcome.** `includeCharts` is off by
default (`lib/photobook/options.ts:69`), and its comment argues the case well —
a book of photographs should not grow chart pages unasked. But when the trip
actually recorded a budget and weather, the owner has usually gone to the
trouble for a reason, and the switch stays off unnoticed.

## Work

- Say on the order page that the spine carries the trip's title, and show the
  title being used.
- Rewrite the warnings for a reader: what will happen to the photograph, how
  much it matters, and what they can do — replace it, drop it, or accept a
  softer print. Point at which photographs, not just how many.
- Default `includeCharts` on when the trip has both costs and `weatherData`,
  and off otherwise. Same for `includeCosts` where a budget exists. Still a
  switch; only the default moves. Update the comment at
  `lib/photobook/options.ts:58` — it is the argument for the old default and
  would otherwise contradict the code.
- Every string in every locale the instance ships.

## Acceptance

- The order page names the spine and the text going on it.
- The low-resolution warning names the affected photographs and says what to
  do.
- A trip with a budget and weather opens the order page with the chart and cost
  pages already on; a trip with neither opens with them off.
