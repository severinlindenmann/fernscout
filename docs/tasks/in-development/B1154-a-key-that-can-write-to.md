---
id: B1154
title: A key that can write to this journal for seven days is visible nowhere in the room
type: FEATURE
priority: high
complexity: medium
area: components/HelperRoom.tsx, app/api/helper
found: "2026-09-09T18:49:31Z"
started: "2026-09-11T06:40:36Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T06:40:36Z"
---

# B1154 — A key that can write to this journal for seven days is visible nowhere in the room

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A key issued to an agent writes to this journal for seven days. The room shows
none of them, so a key you forgot you issued is a key that is still writing and
that you have no way to notice.

`keys` and `revoke_key` exist in the tool registry and work — a person has to
know to *ask the model* for them, in words. That is a discoverability failure
for the one control that is about somebody else's access to your journal.

`/<user>/me` has a device list, which is again a page away from the room.

## Work

A list in the room: what each key is, when it was made, when it was last used,
and one control — revoke.

The route is the work. A page holds a cookie and never a bearer token, so this
needs a cookie-only, owner-only helper route the way
`app/api/helper/[user]/keys/route.ts` already does it — check whether that
route can simply be read from the panel rather than adding another.

**Never print a token.** The list shows dates, never the key. `listSessions`
does not return one and the panel must not be the place that starts.

Not doing: renaming keys, or showing keys for other journals.

## Acceptance

Issue a key through the handover sheet, then open the panel: it is listed with
today's date. Revoke it and a call using it is refused. The rendered HTML
contains no token — assert it in a test the way `test/helper-journal.test.ts`
already does for the tool.

## Decided, before building

A person answered these on 2026-09-09; they are not open questions.

- **The key list shares a sheet with the balance** (B1155), reached from the
  credits pill. The handover prompt (B1153) is a separate sheet.
- The key list is the more important half of that sheet, and should come
  before the balance if only one can be read without scrolling.
