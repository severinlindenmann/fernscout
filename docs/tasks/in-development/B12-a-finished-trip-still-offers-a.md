---
id: B12
title: A finished trip still offers a Today button
type: ISSUE
priority: medium
complexity: low
area: story-nav, tripTime
found: "2026-09-01"
started: "2026-09-03T19:23:10Z"
session: a4b53c2f-00e4-4e62-bc65-91f1f227b1e1
claimed: "2026-09-03T19:23:10Z"
---

# B12 — A finished trip still offers a Today button

## Why

The story pager shows a yellow "Heute" button whenever the reader is not on
the day the trip opened at — `app/TripStory.tsx:292`:

```ts
const awayFromToday = initialDate ? activeIndex !== todayIndex : false;
```

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

**Corrected while building: there were three call sites, not two.** The
capture named the desktop day bar (`app/TripStory.tsx:415–424`) and the
bottom sheet (`components/MobileDaySheet.tsx:96–107`). The trip hero renders
the same button a third time — `components/TripHero.tsx:175–181`, under its
own key `hero.jumpToToday`, wired to the same `jumpToToday` handler and
already holding `over` as a prop for the pulsing dot. It is the copy a reader
meets *first*, on the overview the story opens at, so fixing only the two the
capture listed would have left the most visible one saying "Heute" over a
trip that ended in 2024. This is what settled the approach below: three
independent copies of one two-line decision is why it drifted in the first
place.

## Work

Use `over` to change the label, not to hide the control — a reader on day 3 of
an 18-day trip still needs a way back to where the trip ended.

- Trip live → "Heute", as now.
- Trip over → the last day, said as the last day: a "Letzter Tag" label
  against the same `todayIndex` jump.

Built as **one shared component**, `components/LatestDayButton.tsx`, rather
than the same conditional written out three times. It takes `tripOver`, the
click handler and the caller's `className` (each of the three containers
shapes it differently), and picks both the icon (`LocateFixed` → `Flag`) and
the wording. It also carries `data-jump="today" | "last-day"`, which is the
one thing a test can assert without reading a translation.

All three call sites now render it:

- `app/TripStory.tsx` — the desktop day bar.
- `components/MobileDaySheet.tsx` — the bottom sheet, behind the day list.
- `components/TripHero.tsx` — the overview, which the capture had missed.

Copy: `day.lastDay` added to `content/locales/{en,de,hu}.json` ("Last day" /
"Letzter Tag" / "Utolsó nap") and the key regenerated into `lib/i18n.ts` by
`npm run i18n:keys`. `hero.jumpToToday` is **removed** from all three locales:
it was a second key holding the identical word for the identical button, and
with the hero on the shared component nothing reads it any more.

Renames in `app/TripStory.tsx`, because the names were the bug: `todayIndex` →
`landingIndex`, `todayDay` → `landingDay`, `awayFromToday` → `awayFromLanding`,
`jumpToToday` → `jumpToLanding`; `showToday`/`onToday` on the sheet and
`onToday` on the hero → `showLatest`/`onLatest`. The `initialDate` prop keeps
its name (four page files pass it) but its doc comment no longer claims it is
today.

**Not doing: a third button on the desktop bar.** The "von vorn" question the
capture raised is already answered everywhere — the hero has "Von vorn"
(`hero.startReading`), the mobile sheet has its Overview button, the desktop
sidebar has one at the top of the game path, and the header logo is wired to
`goToOverview`. Nothing is missing, so nothing was added and the narrow end of
`lg` is untouched.

## Acceptance

- On `/example/trips/alps-2024` (a past trip), paging away from the end and
  back offers a control that does not say "Heute".
- On the current trip, the button is unchanged.
- The same holds in the mobile day sheet, not only on the desktop bar.
- `npm run i18n:keys` passes with the new key present in all three locales.

### Evidence

`test/story-jump-label.test.tsx` (8 tests). Server-rendering the real
`example/alps-2024` gives two `data-jump="last-day"` and no `data-jump="today"`;
the same props with the trip forced live give the opposite. A source test
asserts all three call sites render the shared button and none of them still
writes its own `t("day.today")` — the sheet's copy only exists once the sheet
is tapped open, so no server render can reach it. Reintroducing the bug (the
sheet hand-rolling `t("day.today")`, the day bar passing `tripOver={false}`)
fails exactly those two tests.

Checked in a browser against `next dev`, `?lang=de`: on
`/example/trips/alps-2024` the hero and day bar both read "Letzter Tag";
pressing it lands on the last day (the day-bar control correctly disappears
there), paging back one day brings it back still reading "Letzter Tag", and
the string "Heute" appears nowhere on the page. Opening the bottom sheet at
390px shows "Letzter Tag" there too. On the current trip (`/example`) all
three read "Heute", desktop and sheet.
