---
id: B12
title: A finished trip still offers a Today button
type: ISSUE
priority: medium
complexity: low
area: story-nav, tripTime
found: "2026-09-01"
---

# B12 — A finished trip still offers a Today button

## Why

The story pager shows a yellow "Heute" button whenever the reader is not on
the day the trip opened at — `app/TripStory.tsx:292`:

```ts
const awayFromToday = initialDate ? activeIndex !== todayIndex : false;
```

and it is rendered at `app/TripStory.tsx:415–424` on desktop and at
`components/MobileDaySheet.tsx:96–107` in the bottom sheet.

For a trip that is over, "today" is a lie. `getDefaultDay` has already made
`todayIndex` point at the **last** day of the trip — the comment at
`app/TripStory.tsx:326` says so — so the button works, it just describes
itself wrongly. A reader browsing the Alps trip from 2024 is offered a jump to
"Today" and lands in September 2024.

The code already knows the difference. `const over = isOver(trip.trip, index)`
at `app/TripStory.tsx:328` is computed on the very next line and is used only
to decide "how the hero and pager talk about it" — which is exactly this
button, and this button was missed. `isOver` (`lib/tripTime.ts:121`) is
careful about the edge cases: `status: past` settles it outright, and a last
entry dated after `end:` keeps a trip live.

## Work

Use `over` to change the label, not to hide the control — a reader on day 3 of
an 18-day trip still needs a way back to where the trip ended.

- Trip live → "Heute", as now.
- Trip over → the last day, said as the last day: a "Letzter Tag" label
  against the same `todayIndex` jump.

While in there, decide whether a finished trip should also offer "von vorn" —
back to the overview at step 0. `goToOverview` already exists
(`app/TripStory.tsx:307`) and the overview button is already in the mobile
sheet, so on desktop this may be a label change and nothing more. Do not add a
third button to the desktop bar without checking it still fits at the narrow
end of `lg`.

Both call sites, or the bug survives in the sheet: `app/TripStory.tsx` and
`components/MobileDaySheet.tsx`.

New copy needs all three locale files — `content/locales/{en,de,hu}.json` —
and the key added to `lib/i18n.ts`. `npm run i18n:keys` checks the set.

## Acceptance

- On `/example/trips/alps-2024` (a past trip), paging away from the end and
  back offers a control that does not say "Heute".
- On the current trip, the button is unchanged.
- The same holds in the mobile day sheet, not only on the desktop bar.
- `npm run i18n:keys` passes with the new key present in all three locales.
