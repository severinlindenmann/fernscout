---
id: B814
title: The one screen a brand new journal sees has no heading to land on
type: ISSUE
priority: medium
complexity: low
area: agent, a11y
found: "2026-09-07T15:23:20Z"
started: "2026-09-08T20:40:47Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:40:47Z"
---

# B814 — The one screen a brand new journal sees has no heading to land on

## Why

Filed with empty Why/Work/Acceptance. Re-verified against today's code before
building anything, since most of this ticket's siblings this week turned out
already fixed.

Every screen a brand-new owner can actually land on — `/agent` signed out
(`components/AgentDoor.tsx:126`), `/agent` signed in with one journal
(`components/HelperRoom.tsx`, single-journal branch), the wizard
(`components/AgentWizard.tsx:1072`) and `/<user>/trips` (the redirect target
for a journal with no current trip, `app/[user]/trips/TripsIndexContent.tsx:213`)
— already carries a real `<h1>`. That coverage looks recent: B984, merged
today (`81d02ba3`), folded the old `/agent/<user>/chat` room into `/agent`
and is what makes the single-journal case sound now — the room already had an
`<h1>` even before that, so B814 was arguably stale for that path since
before B984 too.

**One screen genuinely had none, and still does until this fix:** `/agent`,
signed in, with **more than one owned journal**. `HelperRoom.tsx`'s header
drew a journal switcher (`<select>`) in place of the plain `<h1>` it draws for
a single journal, and the switcher's own label is `sr-only` — so the whole
page, header through the composer, had no heading element at all. A
screen-reader user landing there had nothing to navigate to, on the one page
here that is a conversation rather than a document with sections.

This does not literally match "brand new journal" (a brand-new owner has
exactly one journal), but it is the one remaining reproducible instance of
"a screen with no heading" in this area, and the same component the ticket's
title points at.

## Work

`components/HelperRoom.tsx`: when `journals.length > 1`, render a visually
hidden `<h1 className="sr-only">` (text: `agent.room.title`, "Talk it
through" — an existing, otherwise-dead locale key left over from the old
`/agent/<user>/chat` page) alongside the `<select>` switcher, so the page
always has exactly one `<h1>` regardless of how many journals the owner has.
The switcher stays the visible control; the heading exists purely as a
landing point. No new locale key, no `i18n:keys` run needed.

Added `test/helper-room.test.tsx`: "B814 — the room has a heading to land on,
with one journal or with several" — renders with one journal (existing
default) and with two, asserting an `<h1>` exists in both, and that the
multi-journal one is `sr-only`. Confirmed it fails without the fix
(`expected null not to be null`) and passes with it.

## Acceptance

- `npx vitest run test/helper-room.test.tsx` — new test passes; fails on the
  pre-fix component (verified by stashing the component change alone).
- `npm run verify` is green: 445 test files, 5786 passed / 4 skipped, build +
  tsc + eslint + knip all clean.
- Every screen a brand-new owner can land on carries exactly one `<h1>`,
  confirmed by reading each component (see Why): `AgentDoor.tsx`,
  `HelperRoom.tsx` (both branches now), `AgentWizard.tsx`,
  `TripsIndexContent.tsx`. Not driven in a real screen reader or browser —
  that verification is left to `test-in-a-browser` / a real AT pass, which
  this session did not run.
- Does not overlap B1019 (`journalsFor`/`evenIfEmpty` routing logic, in
  `testing/`) — that ticket is about *which* screen a brand-new owner is
  routed to; this one is about whether the screen it lands on has a heading.
  No shared lines: B1019 touches `lib/home.ts` and `app/agent/page.tsx`'s
  `journalsFor` call; this touches `components/HelperRoom.tsx`'s header only.
