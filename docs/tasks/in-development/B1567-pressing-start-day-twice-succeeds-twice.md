---
id: B1567
title: Pressing start_day twice succeeds twice
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-12T07:32:00Z"
started: "2026-09-12T07:36:47Z"
session: 47912984-b51b-4d11-b25e-5b026ba593de
claimed: "2026-09-12T07:36:47Z"
---

# B1567 — Pressing start_day twice succeeds twice

## Why

Live session `893fc9b4…` (journal `severin`, 2026-09-12): the `start_day`
proposal was pressed at 06:59:20 **and** 06:59:31, and both presses
recorded `ok`. Only one `2026-09-11` entry exists on disk, so the second
press either silently re-created/overwrote the day or answered success for
doing nothing — either way "ok" twice for one day is a lie in the session
record, and if the route does overwrite, a second press after words were
written would destroy them.

(The stray `2026-09-12` draft in the same trip is probably the room's own
"start this day" for today, not this bug — verify while in there.)

## Work

Establish what `POST /api/helper/<user>/day` does when the day already
exists, and make the second press answer like `publish_day`'s
`already_published` 409 does (B1305): a refusal the press UI can show, not
a second success. If the double-press is a browser-side double-submit,
disable the button on first press as well — but the route answering
honestly is the root cause fix.

## Acceptance

Pressing a start_day proposal for a date whose day already exists answers
with a named refusal (and never overwrites an existing entry); a test on
the route that fails today if it currently answers 2xx. `npm run verify`
green.
