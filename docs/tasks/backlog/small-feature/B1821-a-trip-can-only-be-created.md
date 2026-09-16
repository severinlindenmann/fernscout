---
id: B1821
title: A trip can only be created by talking to an agent
type: FEATURE
priority: high
complexity: medium
area: trips, ui, i18n
found: "2026-09-16T19:34:47Z"
---

# B1821 — A trip can only be created by talking to an agent

## Why

`create_trip` exists only as a tool rendered as a form card inside `/agent`'s
chat (`lib/helper/tools/areas/trips.ts`). There is no `/[user]/trips/new`;
`app/[user]/trips/page.tsx` is a read-only list.

That is already awkward — making a trip is a short, structured, repeated act
and a form is the honest shape for it — and B1820 makes it blocking: once
WhatsApp answers "start a new trip" with a redirect, the redirect needs
somewhere to land.

Design, wireframes at both widths, and English and German copy:
`docs/plans/2026-09-16-capability-split.md`.

## Work

Two screens.

**Screen 1** — title, first day, last day, and who may read it. Nothing else.
Visibility stays here and is never worded by the page's own prose; only the
three canned labels say who can read it. Burying it is how "only my daughter
should read this" becomes a public journal (B923, B931).

**Screen 2** — card colour, subtitle, opening words, other currencies, each
individually skippable.

**The trap:** the optional four are not optional-and-silent. The create route
refuses a submission that says nothing about accent, tagline, intro and rates —
an explicit decline is a recorded answer. **Skip must write the `"none"`
sentinel**, or the page becomes more permissive than the chat path it replaces.

Import the enums from their source (`VISIBILITIES`, `ACCENTS` in
`lib/tripWrite.ts`); never copy the lists.

POST to the existing `app/api/helper/[user]/trip/route.ts`, which
`create_trip` already proposes to. `id` is derived server-side and is not a
field. `cover` is not a field — there are no photographs yet.

**Do not build a "make this the current trip" control.** `deriveStatus()`
already computes `current` from the date range on every read, and v2
`trip.json` stores no status field at all. A toggle would resurrect the exact
bug the migration retired. Where two trips both include today, `loadTrips()`
picks the later `start` — disclose that on the confirmation screen as a notice,
not as a new control.

Success screen sends the person to the trip, or to the import hub to backfill.
Never an "add a day" button; that belongs to WhatsApp now.

Confirmations use `components/ConfirmPanel.tsx`, never `window.confirm`.

Hungarian is not written and must not be invented — see the plan.

## Acceptance

- A trip can be created end to end in a browser, with no agent involved.
- Skipping every optional field produces a trip the route accepts, with the
  declines recorded.
- The new trip shows as `current` when today falls inside its dates, with no
  status field written anywhere.
- Real English, German and Hungarian entries exist for every new string;
  `npm run i18n:keys` is clean.
- Verified in a real browser at desktop and phone width.
- `npm run verify` passes.
