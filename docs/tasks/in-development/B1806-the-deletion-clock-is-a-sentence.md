---
id: B1806
title: The deletion clock is a sentence in the same grey as everything else
type: FEATURE
priority: medium
complexity: low
area: extract, resume, design
found: "2026-09-15T17:44:14Z"
started: "2026-09-15T17:44:41Z"
session: 0e7f2abd-d7ef-4dd2-9733-1fd412b78b47
claimed: "2026-09-15T17:44:41Z"
---

# B1806 — The deletion clock is a sentence in the same grey as everything else

## Why

B1805 replaced a timestamp with a duration, which was right, and left it as
prose in the same grey as every other line on the card:

> noch 1 Tag und 20 Stunden

It reads as a caption. The thing it describes is the deletion of somebody's
photographs, and the screen's whole job is to make them finish the day they
started rather than lose the run. A sentence in body colour does not do that.

A draft was made and approved (2026-09-15). The design file travels with this
ticket at `.superpowers/sdd/b1806/ticker.html` — **read it; do not work from
this prose.** The last time a plan for this feature described a design instead
of handing it over, the result was six tickets of corrections.

## Work

**Segmented monospace digits**, each in its own small box, colon-separated:
`01 : 20 : 14 : 07` with `Tage / Std / Min / Sek` beneath. `font-variant-numeric:
tabular-nums` is not optional — proportional digits make the whole card jitter
once a second, which is the difference between a ticker and a twitch.

**A hairline bar under it**, showing how much of the current window is left.
This is the part that earns its pixels: a duration is a number somebody must
weigh against a window nobody told them the size of, and the bar says *most of
it is still there* without a sentence. Width is a fraction of the **current**
window, so an extension refills it — not a fraction of a fixed 48 hours.

**The ticker gets shorter and louder as it runs out.** Four segments above a
day, three below one, two below an hour. That shape is legible before any single
digit is. Colour walks the same ladder — ink, then yellow, then coral, with the
card picking up a coral wash in the last hour.

**Seconds appear below one hour only**, and the tick rate follows the displayed
precision. B1805 already has that ladder in `lib/staging/countdown.ts`
(`countdownFor` / `tickIntervalFor`) and a shared timer in `ResumeScreen`;
**extend those rather than writing a second clock.** The segments and the tiers
are the same fact shown two ways.

**The pulse is stingy**: last minute only, seconds segment only, and off
entirely under `prefers-reduced-motion`. A card that throbs for two days is a
card people close.

Two states that are reachable and easy to get wrong, both drawn in the file:

- **Past zero** — `00 : 00 : 00`, dashed, and a line saying it goes at the next
  sweep. The sweep runs when somebody opens an import, not on a timer, so a run
  genuinely outlives its deadline and is still listed. Never a negative, never a
  stale positive.
- **Just extended** — the bar refills and the line says why.

Not in scope, and rejected with reasons in the draft: **flip-clock digits.** They
are a per-frame animation on a list that may hold several runs, on a phone. If
the owner later wants them that is a decision, not an omission.

## Acceptance

- The clock is segmented digits with tabular figures; the card does not shift
  width as they change.
- The bar reflects the current window and refills on an extension.
- Segment count and colour follow the ladder; seconds only below an hour.
- The pulse is absent under `prefers-reduced-motion`.
- Past zero reads as about-to-be-cleared, dashed, never negative.
- Verified in a browser at 390px **in both themes, with more than one run
  listed**, and the tick observed across a real interval — not inferred. B1805's
  first report claimed a tick that arithmetic showed impossible; that is the bar
  this has to clear.

## Related

Extends B1805, which built the duration and the destroy control. Same screen.
