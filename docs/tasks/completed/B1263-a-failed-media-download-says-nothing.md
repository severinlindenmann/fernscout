---
id: B1263
title: A failed media download says nothing, and a pin onto an existing day refuses instead of attaching
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper
found: "2026-09-10T10:06:01Z"
merged: "2026-09-10T10:35:15Z"
completed: "2026-09-10T15:12:40Z"
---

# B1263 — A failed media download says nothing, and a pin onto an existing day refuses instead of attaching

## Why

`lib/whatsapp/dispatch.ts`'s `handleMedia` (~434) caught a failed
`downloadMedia` call, logged it with `console.error`, and returned —
nothing was ever sent back to the sender. scenario-dayflow.md's setup note
found this live: a person who just sent a photo has no way to tell a real
failure (an expired token, a rate limit) from "still typing…".

`handleLocationPin` (~512-560) always built a fresh `DraftInput` and called
`createDraft`, with no check for whether a day already existed on the pin's
date. scenario-dayflow.md step 6 reproduced the collision directly:
`createDraft`'s slug (`slugify(date)`) matched a day already written that
same session, `createDraft` refused with `day_exists`, and
`handleLocationPin`'s failure handling discarded that code and always sent
the same `wa.locationIncomplete` sentence — "Road Trip needs more before I
can start a day" — which was worse than a duplicate: it silently swallowed a
real success case (a day existed, ready to take the coordinates) and reported
a misleading reason.

## Work

**Media download failure**: `handleMedia`'s catch block now replies with one
honest sentence (`wa.mediaDownloadFailed`, new key in en/de/hu) before
returning, alongside the existing `console.error`.

**Location pin onto an existing day**: `handleLocationPin` now reads
`getAllEntries(ref, AS_AUTHOR)` for the trip already resolved from the pin's
date and looks for an entry whose `.date` matches. If one exists, the
coordinates (and, where address lookup is on, the place) are attached with
`editEntry` — the same write `PATCH .../days/<slug>` uses — and a new
sentence (`wa.locationAttached`) says which day got them. `createDraft` is
only reached when no day exists yet for that date, which is the only
situation the old `wa.locationIncomplete` sentence was ever honestly
describing. The `createDraft` failure path also now logs `written.error`
rather than discarding it, so a future genuine refusal is diagnosable even
though the sentence to the sender stays the same generic "needs more first"
(nothing narrower to say without inventing a reason the person did not ask
for).

Not done: surfacing `written.error`/`code` in the *sentence* itself (only
the log) — the ticket's own scenario found exactly one reachable failure
(`day_exists`), and that one is now handled before `createDraft` is ever
called, so there is no live case left to word a sentence for; adding one
speculatively is exactly the kind of thing to skip until a second failure
shape is actually seen.

Noticed, not fixed here (scope creep) and captured separately: `handleVoiceNote`'s own
`downloadMedia` catch (~366-370) has the identical silent-failure shape —
captured as its own backlog ticket.

## Acceptance

`test/whatsapp-media.test.ts`, "a media download that fails": a rejected
`downloadMedia` now produces one non-empty reply, in place of the old
silence.

`test/whatsapp-location-contact.test.ts`, "on a date that already has a day
attaches the coordinates instead of refusing": a pin landing on a date with
an existing entry leaves exactly one day for that date, with the pin's
coordinates and the day's original prose both intact.
