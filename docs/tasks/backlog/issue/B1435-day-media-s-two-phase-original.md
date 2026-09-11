---
id: B1435
title: day/media's two-phase original upload may have no live caller since the wizard retired
type: ISSUE
priority: low
complexity: low
area: helper
found: "2026-09-11T09:47:56Z"
---

# B1435 — day/media's two-phase original upload may have no live caller since the wizard retired

## Why

Found while working B1239 (deleting the retired step-wizard's code).
`components/uploadQueue.ts` was the browser half of a two-phase upload: a
downscaled web copy first, then the untouched original sent afterwards to
`app/api/helper/[user]/day/media/route.ts`, which calls `attachOriginal` in
`lib/api/media.ts` to replace the web copy's stem with the real file. It was
deleted along with `AgentWizard.tsx`, since nothing else imported it
(confirmed: `grep -rn attachOriginal app/ lib/ components/` finds only the
route and `lib/api/media.ts` itself, and `grep -rn "day/media\|attachOriginal"
components/EditDay.tsx` — the other place photographs are added to a day —
finds nothing).

`components/HelperRoom.tsx`'s own upload pane (`UploadPanel`, B984/B1171)
says so explicitly in its own doc comment: *"One request, not the wizard's
two-phase queue: an inbox file needs no web derivative before anybody can see
the day, because it is not on a day yet."* That is a real, deliberate reason
the inbox-first redesign does not need two requests — but it also means
nobody has driven `attachOriginal` from a browser since the wizard retired
(B1220), which was **not** what that redesign was explicitly deciding.

This ticket does not establish that the route is dead — only that a
plausible reading of the current call graph says so, and nobody has looked
with that question in mind since B1220 shipped.

## Work

Establish whether `POST app/api/helper/[user]/day/media/route.ts`'s
`attachOriginal` path (an `attach: "original"`-shaped request, or whatever
its actual trigger is — read the route) has any live caller left:

- Check `/agent.md` and `openapi.json` for whether this is documented as
  something an agent over the network is expected to call directly (in which
  case it is not dead, merely browser-unreached).
  ONLY needed there if `attachOriginal`'s corresponding route falls under
  `/api/v1/`, which it does not — this is a wizard-family route.
- Grep for any Playwright/persona test driving `test-with-personas` or
  `test-in-a-browser` that reaches for a phone's original photo upload,
  since a hotel-wifi HEIC upload was the whole reason this path existed
  (see `attachOriginal`'s own doc comment in `lib/api/media.ts`).
- If genuinely unreached: either delete the two-phase path (route + function
  + its tests) or, if the phone-original problem is still real, design its
  replacement in the inbox-based flow rather than leaving the old route as
  an orphaned capability nothing exercises.

## Acceptance

A decision, recorded here: either "still needed, and here is what reaches
it" with the caller identified, or a follow-up ticket that removes the dead
path the same way B1239 removed the wizard's own.
