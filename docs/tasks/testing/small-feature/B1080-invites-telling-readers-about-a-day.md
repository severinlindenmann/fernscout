---
id: B1080
title: Invites, telling readers about a day, and the send channels are unreachable from the conversation
type: FEATURE
priority: medium
complexity: medium
area: lib/helper/tools/areas/readers.ts
found: "2026-09-09T15:41:58Z"
merged: "2026-09-09T15:42:45Z"
---

# B1080 — Invites, telling readers about a day, and the send channels are unreachable from the conversation

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`invite_guest` could issue a link and nothing could list one, revoke one, or
tell anybody a day was published. The two send routes existed and were reachable
only with a bearer token, which a browser deliberately never holds — so the
owner sitting in the room had no way to reach the thing that announces their
own day.

## Work

`invites` (read), `revoke_invite`, `tell_readers`, `channels`. `invites` calls
`listInvites()` rather than `listInvitesWithLinks()`, so a live token is not in
scope to leak in the first place. `tell_readers` is one tool with a `channel`
field over both send routes, and its card names how many people it reaches and
what it costs, from the same `mailWouldReach`/`whatsappWouldCost` the v1 routes
use.

## Acceptance

The card for a mail says a number of people and that it costs nothing; for
WhatsApp it says the credits. `test/helper-readers.test.ts` asserts the invites
read contains no token, no `fs_inv_` prefix and no `url` key.
