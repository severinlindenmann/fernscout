---
id: B1443
title: The files pane still quotes a label that is not on it, and PhotoPicker's override for it is never passed
type: ISSUE
priority: medium
complexity: low
area: helper, room
found: "2026-09-11T11:11:04Z"
---

# B1443 — The files pane still quotes a label that is not on it, and PhotoPicker's override for it is never passed

## Why

**B1272's third acceptance line fails on the deployed build.** Checked in a
live owner session on fernscout.ch at 1280px, 11 September 2026.

The files pane's note reads, verbatim:

> Everything you choose waits under "What is waiting" — photographs, videos, a
> bank statement, a location export (csv, gpx, json, pdf). Then tell me what to
> do with them.

Nothing on the pane says *What is waiting*. Its own labels are PHOTOGRAPHS,
DOCUMENTS, ADD PHOTOGRAPHS OR FILES and STORAGE. `agent.inboxTitle` — which is
that string — is rendered only by `components/AgentInbox.tsx:261`, on the
standalone `/agent/<user>/inbox` page.

The fix B1272 built is present and unwired. `components/PhotoPicker.tsx:116`
added a `noteKey` prop for exactly this, with a comment naming the ticket and
the reason. Nothing ever passes it: `HelperRoom.tsx:2699` renders
`t("agent.pickAnyFile")` directly, bypassing `PhotoPicker` altogether, so the
default note is what a person reads in the room.

`knip` cannot see this — an optional prop that is never passed is not an unused
export.

B1272's other two lines do hold live: with files waiting no text claims nothing
is chosen, and every waiting file has its own one-tap `×`.

## Work

Give the room's own note a key that names the labels the room actually shows,
and render it through `PhotoPicker`'s `noteKey` or delete the prop — one of the
two, not both. A prop nothing passes is the same fault one level down.

## Acceptance

- Every quoted label in the files pane's prose appears on the files pane, in the
  room, at 390px and at 1280px.
- The standalone inbox page still quotes its own heading correctly.
- `npm run verify` clean, including `test/locales.test.ts`.
