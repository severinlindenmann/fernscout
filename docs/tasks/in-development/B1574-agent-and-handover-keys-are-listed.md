---
id: B1574
title: Agent and handover keys are listed inside Guthaben, which is not about money
type: ISSUE
priority: medium
complexity: low
area: agent room
found: "2026-09-12T08:54:28Z"
started: "2026-09-12T09:10:34Z"
session: 5a4744c4-0424-4149-9d23-d8a0bd9dd3b1
claimed: "2026-09-12T09:10:34Z"
---

# B1574 — Agent and handover keys are listed inside Guthaben, which is not about money

## Why

Reported directly: opening "Guthaben" (the credits/account sheet) on
`/agent` shows a "Schlüssel, die hier schreiben können?" ("keys that can
write here") section, which reads as out of place in a screen about balance
and spend.

`components/HelperRoom.tsx:2042-2139` (`KeysSection`) is deliberate, not a
bug in isolation — it was added by B1154 on a documented 2026-09-09 decision
record, specifically because a credits-off instance had no reason to open a
sheet at all before, and a key a person forgot they issued was previously
visible only as a sentence to the model or on the owner's separate `/<user>/me`
device-list page. It is rendered inside `AccountSheet` (the same sheet
`agent.room.account` opens, `HelperRoom.tsx:2149-2156`) and ranked *above* the
balance, per that record, because it was judged "the more important half."

Asked directly whether the framing needed clarifying or the whole thing was
wrong for this screen: **the person's answer is that it should not be here at
all** — `/<user>/me`'s own device list (which already lists and revokes the
same keys, per `KeysSection`'s own doc comment) is enough. This reverses
B1154's placement decision; it does not dispute that revoking a forgotten key
matters, only that the credits sheet is the wrong place to surface it.

## Work

- `components/HelperRoom.tsx` — remove `<KeysSection username={username} />`
  (and the component itself, if nothing else calls it) from `AccountSheet`.
- Leave `GET`/`POST /api/helper/<user>/keys` untouched — `/<user>/me`'s device
  list is the documented alternative surface and needs the same data; only
  the room's own sheet loses this section.
- Check `agent.room.keysTitle` and its sibling locale keys
  (`keysAgentWhole`, `keysAgentTrip`, `keysHandover`, `keysIssuedToday`,
  `keysIssuedDaysAgo`, `keysUsedNow`, `keysUsedDaysAgo`, `keysNeverUsed`,
  `keysRevoke`) for other callers before deleting any of them — `/<user>/me`
  may already use different keys of its own, or may need these; `npm run
  unused` and a grep across `app/[user]/me` will say which.

## Acceptance

- Opening "Guthaben" on `/agent` shows balance, month spend and storage, and
  no keys/tokens section.
- `/<user>/me`'s own device/key list is unaffected and still works.
- `npm run verify` passes, including `test/locales.test.ts` if any locale key
  is removed.
