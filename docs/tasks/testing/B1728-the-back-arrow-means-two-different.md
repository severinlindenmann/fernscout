---
id: B1728
title: The back arrow means two different things and the reader cannot tell which
type: ISSUE
priority: medium
complexity: medium
area: navigation, PageHeader, BackLink, docs, agent
found: "2026-09-14T10:49:12Z"
started: "2026-09-14T10:49:59Z"
merged: "2026-09-14T11:10:31Z"
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

## Validity

**Valid**, confirmed by reading the code before taking it. `components/BackLink.tsx`
still had both modes; `components/useBackHistory.ts` still answered "has this
tab navigated once" and never cleared the flag; `components/PageHeader.tsx:138`
still passed `showLabel={false}` on the phone row. All four consequences above
were reachable from the code on disk.

## What was built, where it differs from the plan above

Eight decisions were made in the code that this section did not settle, and
each is written where it applies as well:

1. **The journal's crumb is called "Trips", not the journal's title.** The
   journal's title is the header's own heading, directly below the trail and
   again beside the phone row's arrow. A crumb carrying it printed one word
   twice, on two controls leading to different pages. The trip list is called
   Trips everywhere else in the site (`SiteNav`), so it is called Trips here.
2. **The trail lists ancestors only** — the current page is not a crumb. The
   row below it is the journal's title and `SiteNav` marks the section with
   the yellow waymark it has always used; a third naming of the page you are
   looking at would be the only crumb nobody could click.
3. **`/{user}/me`, `/search` and `/account` go up to the trip list**, not to
   `/{user}`. They belong to the journal rather than to whichever trip is
   current, and `/{user}` is a trip.
4. **The trip gate and the invite go up to the trip list too.** `/{user}` is
   the current trip's story, and on a gate refusing exactly that trip the old
   link put the reader back on the page they had just been refused.
5. **`components/ContactForm.tsx` was in scope after all.** It had its own
   hand-written `← Back to {title}` pointing at `/{user}` — the same control,
   the same two-meanings problem, written out a second time rather than
   shared. Fixing only the ones routed through `BackLink` would have left it.
   `nav.toJournal` has no callers now and is gone from all three locales.
6. **`HelperRoom` keeps its icon-only arrow**, with the destination as its
   accessible name. It is chrome on a full-height conversation and the word
   would push the journal switcher off a phone — the opposite of the header's
   row, which had space for it and is read by people who are not signed in.
7. **`/docs` gained a step it never had.** Every page under it linked straight
   out to `/`, so the only way from `/docs/hosting` to the hub that lists it
   was the browser's own Back. A guide now goes up to the hub and the hub goes
   up to the site (`components/DocsUpLink.tsx`).
8. **`SiteSummary` carries `name`**, the instance's own name from config. The
   crumb for `/` says "Your journals" to a reader holding an identity and
   names the instance to everybody else, and a client component in the header
   had no other way to ask.

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

### Evidence

`test/nav-up.test.ts` — 21 assertions, both halves: the parent map for every
route in the table, and the source scan (no `back()` or `go(-1)` anywhere in
`app/` or `components/`, with comments stripped so the files that explain the
removal may name it; and the three deleted files stay deleted). Registered in
`scripts/check-changed.mjs` so an edit under `app/` or `components/` selects it.

`test/back-to-journals.test.tsx` — B433's keeper, rewritten to the new
contract: a stranger is now offered a way out under the instance's name, the
journal's crumb is its trip list named for that page, a way up renders at both
widths and carries a word at both, and nothing in the title box is a
`<button>`.

Browser, `/tmp/b1728-shots/`, at 1280 and 390 against `content/example/`, which
predates this branch. Header links read out of the served HTML:

| page | trail |
| --- | --- |
| `/example` | `Fernscout` → `/`, `Trips` → `/example/trips` |
| `/example/trips` | `Fernscout` → `/` |
| `/example/gallery` | `Fernscout`, `Trips`, `Across and back` → `/example` |
| `/example/trips/asia-2023/gallery` | `Fernscout`, `Trips`, `Five months east` → `/example/trips/asia-2023` |
| `/example/me` | `Fernscout`, `Trips` |
| `/docs` | `Fernscout` → `/` |
| `/docs/hosting` | `Documentation` → `/docs` |
| `/agent` | `Fernscout` → `/` |
| `/example/trips/a-wedding-2026` (the gate) | `Fernscout Demo` → `/example/trips` |

Zero console errors on every page. The one failed request on the two story
pages is `/api/reactions` answering 404 with the capability off, which is this
repository's absent-rather-than-broken rule and predates the branch.
