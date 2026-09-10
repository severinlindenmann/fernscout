---
id: B1300
title: With one day of costs the bar chart is a full-width block and the running total draws nothing
type: ISSUE
priority: medium
complexity: low
area: costs, dataviz
found: "2026-09-10T11:14:27Z"
---

# B1300 — With one day of costs the bar chart is a full-width block and the running total draws nothing

## Why

`/test-mobile/costs` with exactly one cost recorded — CHF 24, one day — at 390px:

**"Day by day"** draws a single bar that fills the entire chart width and about
110px of height: a solid green block, edge to edge. Both axis labels read
**5 Sep** — the same date at the left end and the right end of the range. It does
not read as a chart; it reads as a progress bar that is full.

**"Running total"** draws four grey gridlines and **nothing else**. A line needs
two points and there is one, so the chart is an empty frame with "5 Sep · CHF 24"
underneath it.

**The green is unexplained.** The category chart directly above uses the brand
yellow, and its legend says *Food & drink · CHF 24* — the same twenty-four
francs. The day bar is green, and green appears in no legend on the page. A
reader has no way to know whether the colour means something.

The tiles and the category chart are fine, and the page's closing sentence —
*"Prices are what Mo actually paid, converted to CHF at the rate on the day"* — is
exactly right.

This is the same shape as B1260 on the trip page: modules drawn in full whether or
not there is enough data for them to mean anything, and a new journal is the state
they look worst in.

## Work

- Decide the minimum each chart needs. A bar chart wants more than one bar; a
  running total wants more than one point. Below that, the number alone says more
  than the frame does.
- Say what the green means, or use the colour the category chart already
  established for the same money.
- Check the same page at two days and at five before concluding the thresholds.

## Acceptance

- A trip with one day of costs shows no full-width single bar and no empty chart
  frame.
- Every colour on the page appears in a legend or is explained.
