---
id: B1321
title: Deleting a trip requires a mailbox round-trip even for the owner standing on its page
type: FEATURE
priority: high
complexity: medium
area: trips, deletion
found: "2026-09-10T15:47:45Z"
started: "2026-09-10T15:47:56Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T15:47:56Z"
---

# B1321 — Deleting a trip requires a mailbox round-trip even for the owner standing on its page

## Why

B38 routes every deletion through a mailed single-use link, because the
asker is usually an agent whose "the owner told me to" is unverifiable. But
the owner standing on the trip's own page with their browser session *is*
verified, and the helper's refusal ("das Löschen endet in deinem Postfach")
read as a dead end to the owner, who asked for a Delete button with an
inventory confirmation (2026-09-10).

## Work

- `app/[user]/trips/[trip]/delete/route.ts` — cookie-only owner door, the
  postcard-send shape: any `Authorization` header refused outright; `GET`
  answers the inventory (days/files/size via `summarise`), `POST` runs the
  same `deleteTrip` the mailbox path runs (now exported from
  `lib/deletions.ts`).
- `components/DeleteTrip.tsx` — a quiet coral text link at the foot of
  `OwnerTools` on the trip overview only; press fetches the inventory and
  asks in a `ConfirmPanel` naming days, files and size; an empty trip
  (no days, nothing beyond trip.md) deletes on the first press, per the
  owner's ask.
- Locales: `del.tripButton/tripQuestion/tripFailed` in en/de/hu;
  `agent.askRefuseRemove` now points at the button for a trip while a whole
  journal still ends in the mailbox.
- AGENTS.md: the deletion paragraph carries the amendment; nothing changes
  for agents — `DELETE /api/v1/...` still answers 202 and mails.

## Acceptance

Signed in as the owner on a trip overview, "Delete this journey" opens a
panel reading "… X days and Y files (Z) go with it …"; confirming removes the
trip, redirects to the journal, and the old URL answers 410. A request with
any bearer token gets `not_for_agents` 403. Verified end to end in Playwright
against a disposable test trip on 2026-09-10.
