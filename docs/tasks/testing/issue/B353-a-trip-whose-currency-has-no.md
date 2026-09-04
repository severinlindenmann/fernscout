---
id: B353
title: A trip whose currency has no rate shows CHF 0 everywhere except the costs page
type: ISSUE
priority: high
complexity: low
area: costs
found: "2026-09-04T19:57:18Z"
started: "2026-09-04T20:35:16Z"
merged: "2026-09-04T20:56:14Z"
---

# B353 — A trip whose currency has no rate shows CHF 0 everywhere except the costs page

## Why

The costs page handles an unrated currency carefully: it excludes those amounts
from the totals and says so, in a paragraph explaining that folding them in
would "look right and be wrong". That is the correct decision.

Every other surface then shows the number it was protecting the reader from.
The journal home and the trip overview print:

> Total so far **CHF 0** · Average per day **CHF 0**

with no caveat anywhere near them, for a trip with EUR 80 of logged spend.
Zero is not "unconverted" — it is a figure, and a wrong one. The whole argument
of the costs page is that a wrong-looking-right number is worse than an honest
absence, and the summary tiles are exactly that number.

Observed 2026-09-04 on fernscout.ch: `balkans-2026`, four costs totalling
EUR 80.40, base currency CHF, no rate table on the trip. Journal home, trip
overview and the trips listing all showed CHF 0.

## Work

Wherever a total is rendered from converted costs, a total that had amounts
excluded is not a total. Show a dash, or the unconverted figure, or the count
of what was left out — anything that is not a confident zero. The costs page's
own paragraph is the model for the wording.

Related: B352, which is why the rate cannot simply be supplied.

## Acceptance

A trip with costs only in an unrated currency shows no "CHF 0" total on the
journal home, the trip overview or the trips listing.
