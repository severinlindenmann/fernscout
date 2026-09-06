---
id: B544
title: A day shows what it cost in the reader's currency and never in the one it was paid in
type: FEATURE
priority: medium
complexity: low
area: costs, currency, ui
found: "2026-09-06T08:48:45Z"
---

# B544 — A day shows what it cost in the reader's currency and never in the one it was paid in

## Why

The day story already draws a day's spend, and draws it only converted:
`money(cost)` in `components/StoryPager.tsx:261` and
`components/MobileDaySheet.tsx:159`, where `cost` is the base-currency total
from `costForDay` (`lib/costs.ts:343`). A day in Thailand reads `CHF 42`.

The baht never appears anywhere but the costs page's own item table
(`app/[user]/(trip)/costs/CostsPageContent.tsx:199`), which is the one place
that gets it right: the converted figure leads and what was actually paid sits
beside it. The day view is where a reader actually is, and it is the surface
that drops the real number.

It is also the figure a reader can check. `CHF 42` is unverifiable; `THB 1'520`
is what the receipt says.

## Work

`summarise()` (`lib/tripView.ts:63`) gains `costLocal?: { amount, currency }`,
set only when every cost on that day shares one currency and it is not the
base. A mixed-currency day keeps exactly today's single converted total —
summing two currencies to show one "local" figure is the failure this whole
package rules out.

`StoryPager` and `MobileDaySheet` then lead with the local figure and put the
converted one beside it: `THB 1'520 ≈ CHF 42`, through the existing
`original()` and `money()` on `useMoney`. When the reader's chosen currency
already is the local one, one figure and no `≈`.

`withoutCosts()` (`lib/tripView.ts:115`) must strip `costLocal` as well, or
`costsVisibility: guests` leaks the numbers it exists to withhold — it strips
`costs` today and a new field beside it is exactly what that function is for.

Check the sheet at 390px: the chip is already tight and this makes it longer.

## Acceptance

- A day whose costs are all in one non-base currency shows that amount and
  the converted one, marked `≈`.
- A mixed-currency day is unchanged.
- A day in the base currency is unchanged, with no `≈`.
- With `costsVisibility: guests` and a reader who is not one, neither figure
  appears anywhere in the page source.
- Legible at 390px.
- `npm run verify` passes.
