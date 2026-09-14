---
id: B1728
title: The back arrow means two different things and the reader cannot tell which
type: ISSUE
priority: medium
complexity: medium
area: navigation, PageHeader, BackLink, docs, agent
found: "2026-09-14T10:49:12Z"
---

# B1728 — The back arrow means two different things and the reader cannot tell which

## Why

Reported from use: "sometimes I click it and think now I should go back to
fernscout.ch, instead I go to the last page visited."

`components/BackLink.tsx` has two modes. Fixed-parent renders a real `<Link>`
carrying a specific word — "Your journals", "Back to Fernscout". Retrace
renders a `<button>` calling `router.back()` labelled only "Back". Which one
you get is decided by `useHasInAppHistory()` in `components/useBackHistory.ts`.

That hook does not answer the question the arrow needs answered. It answers
*"has this tab soft-navigated at least once"* — a `sessionStorage` flag set by
`components/BackTracker.tsx` and never cleared. The arrow needs *"is the
history entry behind me in-app"*. Four consequences, and the report is the
first of them:

1. **It latches.** Story → Gallery sets the flag. For the rest of the tab's
   life every arrow on every page is `router.back()`, including the header one
   whose only job is to leave the journal.
2. **Wrong axis.** `components/PageHeader.tsx:367` says in its own comment
   "Above the title because it is a breadcrumb." A breadcrumb means *up*.
   `router.back()` means *back*. One control, two meanings, switched by
   invisible tab state.
3. **The warning does not render where it matters.** The phone row
   (`components/PageHeader.tsx:138`) passes `showLabel={false}`, so the label
   swap that was meant to signal the change in meaning is never drawn. Same
   arrow, same place, different destination.
4. **No honest target.** Retracing is a `<button>`, so there is no hover
   preview, no middle-click, no way to know before committing. Two taps can
   also walk out of the site: the flag never claimed the entry *behind* you
   was in-app.

Secondary, and the other half of why the arrow feels arbitrary: four of the
five call sites point at `/` regardless of where they sit —
`app/docs/layout.tsx:28`, `app/agent/[user]/layout.tsx:29`,
`components/AgentDoor.tsx:119`, and both `PageHeader` rows. And there is no
journal home to point at: `/{user}` is the *current trip's story*
(`components/TripProvider.tsx:103`), so "up from a trip" has nowhere obvious
to land.

This reverses the decision taken in B822, which introduced the retrace mode to
serve the reader who arrives deep on a shared link. That reader is served
better by an Up link that names a real destination than by a Back button that
names none.

## Work

**Fernscout never draws Back. Fernscout draws Up.** The browser and the phone
already own Back — swipe, hardware button, Alt+←. The app stops competing.

- Delete `components/useBackHistory.ts` and `components/BackTracker.tsx`, and
  remove the `BackTracker` mount from `app/layout.tsx`. `BackLink` collapses to
  a `<Link href label>` — one mode, a real href, hover and middle-click intact.
  Rename it to say what it is now.
- Every arrow carries the destination's own name, never the word "Back".
- The phone header row gets the word too (drop `showLabel={false}`, truncate).
- Draw it for strangers as well, not only `site.hasIdentity` — a reader who
  arrived on a shared link is exactly who is stuck without it. The word differs:
  identity gets "Your journals", a stranger gets the Fernscout landing page.

Parents, per route:

| page | up to |
| --- | --- |
| `/{user}` (current trip story) | `/{user}/trips` |
| `/{user}/trips/{id}` | `/{user}/trips` |
| `/{user}/gallery`, `/map`, `/analytics`, `/day/*`, `/costs`, `/weather` | that trip's story, `trip.href("/")` |
| `/{user}/trips` | `/` |
| `/{user}/me`, `/search`, `/account` | `/{user}` |
| trip gate, `/{user}/i/*` | `/{user}` |
| `/docs/*` | `/docs` |
| `/docs` | `/` |
| `/agent/{user}/inbox` | `/agent` |
| `/agent` (door and room) | `/` |

`/{user}/trips` becomes the journal's home in the hierarchy — decided rather
than building a new `/{user}` overview page, because the trip list already
exists and already lists every trip, and `/{user}` cannot change meaning
without breaking every shared link.

Then the trail. At `sm` and up the header draws at most three crumbs —
`Fernscout › Sommer 2025 › Tag 4` — last crumb the current page and not a
link, earlier ones links, replacing the single arrow above the title. It
answers "where am I", which one arrow never could. **On a phone it stays one
crumb**, the immediate parent only: the row already carries the journal title,
the section disc and the menu button, and the page below it has a fixed bottom
day-navigator, so a second row is not available.

Not doing: any change to `PagerNav`, `SlideShow`, `Lightbox` or
`DayControls` — their chevrons step through content and are not navigation.
No new route. No change to `SiteNav`'s destinations.

New UI strings need real English, German and Hungarian entries; run
`npm run i18n:keys` after English.

## Acceptance

- No `router.back()`, `history.back()` or equivalent anywhere in `app/` or
  `components/` — a keeper test that scans source and fails if it returns.
- A keeper test over the parent map: each route in the table above resolves to
  the parent it names.
- Driven in a real browser at desktop and phone width, against content that
  existed before this branch: every arrow on the journal, a trip, gallery, a
  day, `/docs`, `/agent`, and the trip gate goes exactly where its word says,
  and says the same thing twice in a row from the same page.
- `npm run verify` passes.
