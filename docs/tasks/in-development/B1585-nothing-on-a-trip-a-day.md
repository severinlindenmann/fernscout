---
id: B1585
title: Nothing on a trip, a day, a photograph or the journal says who may read it, and changing that means knowing where the control hides
type: FEATURE
priority: high
complexity: high
area: owner tools, visibility, trip page, day page, gallery, /me
found: "2026-09-12T13:19:11Z"
started: "2026-09-12T13:35:34Z"
session: 8ab36c58-f1c6-4425-bad2-8726044a90c9
claimed: "2026-09-12T13:35:34Z"
---

# B1585 — Nothing on a trip, a day, a photograph or the journal says who may read it, and changing that means knowing where the control hides

## Why

**Validity, 2026-09-12: valid.** Not a revalidation of an old ticket — every
file:line in the table below was read on the day this was captured, from the
checkout at `200af881`, which is what the table is. Nothing here is inherited
from an earlier reading.

Asked for by the author, in these words: *"where can I see and change the
status of an object? I would like as owner of the page see per trip, per day
and per media better what is public, private or guest and change it also
easily in the frontend."* The reading behind the question matters more than the
request — **the owner of a live journal cannot tell, from looking at it, what
of it is on the public internet.** That is the failure; badges are one fix for
it.

Four levels answer that question and each answers it somewhere else:

| Level | Owner can see it | Owner can change it |
| --- | --- | --- |
| Journal `visibility` (public/guest) | `/[user]/me` — as the *state of a checkbox*, never as a word (`app/[user]/me/MePageContent.tsx:446`) | same checkbox, two presses (`:446`–`:482`) → `PATCH /api/journal` |
| Trip `visibility` | nowhere on the trip itself; `/me` only after clicking the pencil (`MePageContent.tsx:698`), or inside a day's correction panel (`components/EditDay.tsx:317`) | those two selects |
| Trip `listed` | `EditDay.tsx:331` only — and only while the trip is already `public` | there only |
| Trip `teaser` | **no UI at all** | API only |
| Day/update `visibility` | a badge beside the title, **only when narrowed** (`components/EntryVisibilityBadge.tsx`, mounted `components/StoryPager.tsx:527`) | `EditDay.tsx:546` |
| Photo `visibility` | a badge on the tile, **only when narrowed** (`components/PhotoVisibilityBadge.tsx`, mounted `components/Gallery.tsx:105` and `components/GalleryGrid.tsx:177`) | `EditDay.tsx:483`, one select per photo; nothing on `/[user]/gallery` |

Three specific ways that misleads, all of them found by reading the code above:

- **Absence of a badge means two different things.** B631/B632 mark a day or a
  photograph that has been *narrowed*. A day that simply inherits the trip is
  unmarked — and so is a day on a `public` trip. The owner cannot distinguish
  "no per-day setting" from "on the open internet", which is exactly the
  distinction they asked for.
- **The trip is the gate and it is the one level with no label anywhere.**
  `/[user]/trips/<trip>` renders nothing about its own visibility. The tag on
  `/me`'s trip rows (`MePageContent.tsx:936`) looks like one and is not — it is
  `resolveViewer`'s *reason this reader may open it*, which coincides with the
  trip's `visibility:` only sometimes.
- **`listed` is reachable only through a day.** To stop advertising a trip the
  owner opens a day on it, opens the correction panel, and finds a checkbox
  that is only rendered because the trip happens to be `public`. An unlisted
  trip then vanishes from `/[user]/trips`
  (`app/[user]/trips/TripsIndexContent.tsx:72`) with nothing saying why, for the
  owner too.

The vocabulary is also genuinely confusing, and the codebase knows it —
`AGENTS.md` spends four paragraphs on it and `MePageContent.tsx:400` carries a
doc comment about the trap. `guest` means *the people I let into this journal*
at trip level and *not advertised* at journal level; `private` exists at trip
level and deliberately does not at journal level. An owner deciding in a hurry
has nothing on screen telling them which meaning they are picking.

Nothing here is a security hole: `visible()` in `lib/entries.ts` and
`app/[user]/media/[...path]/route.ts` still enforce every gate. This is about
the owner being able to *audit their own journal by looking at it*.

## Work

**One shared control, four mount points.** The decisions below were taken by
the author on 2026-09-12; do not relitigate them.

A new `components/VisibilityControl.tsx` (name is a suggestion), taking the
current value, the level it belongs to, and whether the reader is the owner.
It renders as a badge and, for the owner, opens as a control. It replaces
`EntryVisibilityBadge` and `PhotoVisibilityBadge` rather than sitting beside
them — two vocabularies for one idea is what this ticket is fixing.

- **Always show the effective state, including `Public` — but only for the
  owner.** Everybody else keeps exactly what they see today: a narrowed-only
  badge for a `person`-level reader, nothing for a guest. A public trip must
  not grow chrome for the public.
- **Effective, not literal.** A day with no `visibility:` on a `guest` trip
  reads *Guest*, with the fact that it is inherited said quietly (a lighter
  weight, or "wie die Reise" beside it) rather than shown as blank. `readFor`
  in `lib/tripGate.ts` and the trip's own value are what compute it.
- **The badge is the control, owner only.** Clicking it opens a small panel
  with the options and a second press to confirm, `components/ConfirmPanel.tsx`
  or the same shape `MePageContent.tsx:711` already uses. No new routes — every
  level already has a cookie-authenticated owner door: `PATCH /api/journal`,
  `PATCH /[user]/trips/[trip]/visibility`, `PATCH
  /[user]/trips/[trip]/day/[slug]/edit`.
- **The second press is always, not only when widening.** `/me`'s trip select
  already works this way and says why in a comment at `MePageContent.tsx:713`;
  copy that, and this supersedes B1143.
- **One shared `?` explainer**, covering all three words in one hover/tap
  panel, reused at every level. Where a level's meaning differs — journal
  `guest` is *unlisted*, not *invited-only* — the panel says so in that
  sentence. New keys in `site/locales/en.json`, `de.json` and `hu.json`, real
  German and real Hungarian, then `npm run i18n:keys`.
- **`listed` and `teaser` ride with the trip control.** `listed` wherever a
  trip's visibility is editable — not only from inside a day, and shown (as
  refused/greyed with a reason) rather than hidden when the trip is closed.
  `teaser` on a closed trip only, which is where the server already allows it
  (B587). `patchTripVisibility` stays the real guard.

Mount points:

1. `/[user]/trips/<trip>` — the trip's own page, near the hero. Beware:
   `TripHero` renders after the animation, so this is not checkable with curl.
2. `/[user]/trips/<trip>/day/<slug>` — next to the day title, replacing
   `EntryVisibilityBadge` at `StoryPager.tsx:527`. Per *update*, since several
   updates share a day.
3. Photo tiles in `Gallery.tsx` and `GalleryGrid.tsx`, replacing
   `PhotoVisibilityBadge`. Whether the tile badge opens a control in the
   gallery, or the gallery only labels and the editing stays in `EditDay`, is
   the one thing left open — decide it when the control exists and say which
   in this file.

   **Decided while building: label only.** A photograph's visibility is
   written by a `PATCH` on the *day* that carries it, and the trip gallery's
   tiles come from every day at once, so a control there would either need
   each tile to carry its day or would be a second, lonelier way to do what
   the correction panel already does with every tile of the day side by side.
   What the owner was missing was *seeing* the state without opening
   anything. `PhotoBadge` carries the reasoning.
4. `/[user]/me` — a badge on each trip row saying the trip's own visibility,
   **beside** the existing reason tag rather than replacing it (they are
   different facts), and one on the journal title. The journal checkbox at
   `MePageContent.tsx:446` becomes this control.

Not doing: any change to what a non-owner sees; any new API route; a
visibility control on `/agent` or in the helper; anything about who may read
what — the gates in `lib/entries.ts`, `lib/tripGate.ts` and the media route are
untouched.

Beware the two-vocabulary trap the codebase already warns about: journal
`guest` and trip `guest` are different populations, and a shared component that
prints one word for both is how the wrong one gets picked. The strings are
per-level even though the component is shared.

## Acceptance

As the owner, on the live journal, with nothing to click through first:

- `/[user]/trips/<trip>` says whether that trip is Public, Guest or Private,
  and whether it is listed.
- A day with no per-update visibility on a public trip reads *Public*, not
  blank. A day narrowed to `private` on a `guest` trip reads *Private*.
- Every photograph in the day view and in `/[user]/gallery` carries its state.
- `/[user]/me` shows each trip's visibility as well as why the reader may open
  it, and the journal title carries its own.
- A `?` at any of them explains all three words.
- Changing any level from the badge takes two presses and never a
  `window.confirm` (B633/B668; `test/no-browser-dialogs.test.ts` enforces it).
- `listed` and, on a closed trip, `teaser` are reachable without opening a day.

Signed out, and as a guest: every page renders exactly as it does today. As
somebody on the trip: narrowed days and photographs carry their badge as they
do today, and nothing else appears.

`npm run verify` green, including `test/locales.test.ts`. Checked in a browser
at 390px and on a trip written before this branch (B1090) — not only on content
the change created.

Supersedes B1143, whose question ("does widening a trip from the day panel
deserve a second press") is answered here: every level gets one, always.

## What building it changed

**B1586, found before a line was written and fixed on this branch.** The route
this ticket planned to reuse for a photograph's label —
`PATCH /[user]/trips/[trip]/day/[slug]/edit` — kept an allow-list that B980
round 2 never widened, so `captions` and `photoVisibility` were answering 400
`unsupported_field` and taking the rest of the patch (a title, say) down with
them. Four days broken. It is captured as its own ticket with its own
regression test, and fixed here because B1585 could not be accepted while the
door refused the field.

**`readFor` gained `owner`, beside `canPublish`.** They are the same boolean
from the same `isOwner` call, and they are two questions —
`GalleryGrid`'s own comment had already argued that borrowing one for the
other is how a field ends up answering two things. Six pages pass it on.

**Deviation: `listed` is on the trip control, `teaser` is too, and the journal
level keeps its checkbox.** The journal's existing control on `/me` already
had two presses and good copy in three languages; it gained the word and the
`?` rather than being rebuilt as a select, which would have been churn for no
gain.

**Deviation: no badge in `PageHeader`.** The journal title renders site-wide
for every reader; an owner badge there would appear on every page of the
journal. The journal's word sits on `/me`, where the setting is.

**Inherited badges are dimmed.** Found by looking: a public gallery is twelve
tiles all saying "Public", which is twelve pills the owner reads past — and
reading past them is how the one held-back photograph gets missed. The word
stays (absence is what the ticket was about) and the exception carries the
weight.

**`<details>` cannot live in a `<p>`.** Two of them did on `/me`, which is a
hydration error and nine console errors. Caught by reading `check-page.mjs`'s
JSON rather than by looking at the screenshot, which showed nothing wrong.

Not covered, and deliberately: the countdown branch of a trip page (an
upcoming trip renders `TripCountdown`, not the hero, so it has no badge).
