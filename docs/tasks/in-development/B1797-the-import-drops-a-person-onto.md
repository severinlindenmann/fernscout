---
id: B1797
title: The import drops a person onto a bare file picker with no framing, no way back, and no way in from the journal
type: FEATURE
priority: high
complexity: medium
area: extract, onboarding, nav
found: "2026-09-15T12:15:19Z"
started: "2026-09-15T12:15:44Z"
session: 0e7f2abd-d7ef-4dd2-9733-1fd412b78b47
claimed: "2026-09-15T12:15:44Z"
---

# B1797 — The import drops a person onto a bare file picker with no framing, no way back, and no way in from the journal

## Why

B1751 shipped the camera-roll import and it works, but the first screen a person
meets is a title, a file button and three paragraphs. Seen on the live instance
(`/severin/extract`, 2026-09-15) it reads as a control panel rather than the
start of something.

Three things are missing, and the first two are omissions in B1751's own plan
rather than decisions anybody made:

**The design's first two screens were never built.** The published draft had a
Step 01 that says what is about to happen — four things, in order, with how long
each takes — plus where the photographs go (a holding area outside the storage
quota, cleared after two days) and that nothing becomes visible without a
separate act. And a Step 02 asking whether this is a new trip or an existing one,
and whether the person would rather talk or type. **The routes already accept
both answers**: `RunManifest` carries `tripId` and `mode`, and
`POST .../extract/start` reads them from its body. Nothing ever sends them, so
every run is a new trip in typing mode by default. No task brief in that plan
ever specified those screens — the brief for the upload step was written as
though it were the entry point.

**There is no way back.** An owner who opens the import and changes their mind
has no link to their own journal.

**There is no way in.** `components/SiteNav.tsx:138` already has an
`if (site.isOwner)` branch that adds the account entry; nothing beside it points
at the import, so the only route is typing the URL.

And one thing that was never in the design and should have been: **the import is
only about photographs.** A trip's other material — location history, contacts,
bank statements — has working importers (`importers/gps/`, `importers/contacts/`,
`importers/costs/`) and live helper routes, and no way in from the site at all.

## Work

Decided with the owner, 2026-09-15:

**A hub at `/<user>/extract`** — "what do you want to bring in?" — offering
photographs, location history, contacts and bank statements. Photographs lead to
the guided flow that exists. **The other three are a plain file upload for now**:
pick a file, it goes through the importer that already exists, the person sees
what it read. Guided flows for those come later and are explicitly not this
ticket.

The three doors already exist and must be used rather than rebuilt:
`POST /api/helper/<user>/import` (GPS), `POST /api/helper/<user>/contacts/import`,
and the statement route for costs. Read each before wiring it.

**Build Step 01 and Step 02 as the design has them.** The manifest and the start
route already take `tripId` and `mode`; this is the UI that finally asks.

**A back link** to the journal, on the hub and on the flow.

**An owner-only entry in `SiteNav`**, in the existing `isOwner` branch.

Design: match the published draft's register rather than the current bare page.
The draft is the reference for what this should feel like, not a pixel spec.

## Acceptance

- `/<user>/extract` shows four choices; photographs opens the guided flow and the
  other three accept a file and report what was read.
- A new run created through the UI carries the person's real `tripId` and `mode`
  rather than the defaults — assert on the manifest, not on the screen.
- Every screen in the flow has a way back to the journal.
- An owner sees an import entry in the nav; a guest and a stranger do not.
- Verified in a real browser at 1280 and 390 against the live-shaped content,
  with the capture kept.
- Real en/de/hu for every new string.

## Related

Follows B1751, whose plan is `docs/superpowers/plans/2026-09-15-camera-roll-import.md`.
The two missing onboarding screens are a gap in that plan, not in its execution.
