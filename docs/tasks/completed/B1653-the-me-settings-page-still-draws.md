---
id: B1653
title: The /me settings page still draws inputs for two fields v2 dropped, so typing in them does nothing
type: ISSUE
priority: medium
complexity: low
area: Webapp
found: "2026-09-13T09:10:25Z"
merged: "2026-09-13T19:50:30Z"
completed: "2026-09-14T16:32:30Z"
---

# B1653 — The /me settings page still draws inputs for two fields v2 dropped, so typing in them does nothing

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The v2 journal document has no `startLocation` and no `ownerTel` — both
dropped deliberately (`lib/api/v2/schemas/journal.ts`, owner decision
2026-09-12). `app/[user]/me/MePageContent.tsx` still draws an input for each.

Since the settings panel moved onto the v2-backed cookie proxy (phase 2 step
5), those two inputs no longer send anything. A person edits one, presses
save, the save succeeds — and the value is gone. Nothing tells them.

That is the shape this project treats as most serious: not a failure, but a
success reported for something that did not happen. The page cannot know, and
the words on the screen are all somebody has.

`ownerTel` deserves thought before it is simply deleted. It is the number a
WhatsApp evening reminder is sent to — `lib/api/tripReminder.ts` refuses the
whatsapp channel outright when the owner has no `tel` on file. If there is no
longer any way for an owner to set one, that channel is unreachable for every
journal that does not already have it.

## Work

Decide per field, then make the page tell the truth:

- **`startLocation`** — nothing reads it. Remove the input.
- **`ownerTel`** — establish where, if anywhere, it can still be set. If
  nowhere, it needs either a home in the journal document (a D row) or an
  honest sentence on the page saying why the messenger reminder cannot be
  switched on here.

Not doing: restoring either field to the schema unilaterally. That is the
owner's call, which is why this is a ticket and not a patch.

## Acceptance

No input on `/me` accepts a value it will not store. If `ownerTel` stays
unsettable, somebody reading that page can tell why the WhatsApp reminder is
unavailable to them.
