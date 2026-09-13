---
id: B1662
title: A v2 day's private/guest photograph visibility is not enforced by the file-serving route
type: ISSUE
priority: medium
complexity: medium
area: API v2 / media
found: "2026-09-13T12:19:30Z"
wontDo: \"Checked and the premise is false — the gate does enforce per-photo visibility on v2 days. Evidence below.\"
---

# B1662 — A v2 day's private/guest photograph visibility is not enforced by the file-serving route

## Why

Found while building B1656 (the v2 day media attach/detach door,
`app/api/v2/{user}/trips/{trip}/days/{slug}/media`). A photograph attached to
a v2 JSON day (`content/<user>/trips/<id>/entries/<slug>.json`) with
`visibility: "guest"` or `"private"` is stored faithfully and read back
correctly by every v2 route — but `app/[user]/media/[...path]/route.ts`'s
per-photograph gate (`labelOf`, `:file:94-116`) never sees it: that function
finds a photo's label by scanning v1 markdown entries only
(`getAllEntries`/`getEntryBySlug`, `lib/entries.ts`), which know nothing
about a day that exists solely as a v2 document. `labelOf` returns
`undefined` for such a photograph, the `maySeePhoto` check is skipped
entirely, and the file is served to anyone who can already read the trip
(`mayReadTrip`) — narrower visibility on the photograph or the day is
silently not honoured.

AGENTS.md is explicit that this is the shape of bug that matters most here:
"Two halves make it real, and half of it is worse than none" — `visible()`
in `lib/entries.ts` strips a labelled item from every reading path, and this
route is the other half, refusing the file itself. For any photograph
attached to a v2-native day, only the first half currently exists.

This is not new with B1656 and not introduced by it: it is true of every v2
day's `media` array today, a consequence of the read layer
(`app/[user]/...` pages, and this file) still reading v1 markdown entries
while writes have moved to v2 JSON documents (B1598's tracked phase-3
replay). B1656 did not attempt to fix it — closing it properly is the
replay flip, a much larger piece of work already tracked elsewhere — but it
is worth a ticket of its own precisely because "predates this feature" is
not the same claim as "not a live gap": today, on a checkout where a v2 day
carries a private photograph, that photograph is reachable at its URL by
anyone who can read the trip at all.

## Work

Two shapes to choose between, not decided here:

- Wait for B1598's phase-3 replay to make `app/[user]/...` read v2 JSON
  days directly — at which point `labelOf` (or its replacement) reads the
  real source of truth and this closes as a side effect.
- A smaller, sooner fix scoped to this one gate: extend `labelOf` to also
  scan a trip's v2 day documents (`lib/api/v2/store.ts`'s `listDaySlugs`/
  `readDayFile`) for a matching `src` when the v1 scan finds nothing,
  combining strictest/loosest across both scans the same way the function
  already does within the v1 gallery. Bounded to one file, but is scoped
  work ahead of the general replay and worth weighing against just doing
  the replay sooner.

## Acceptance

A photograph attached to a v2-native day via
`POST /api/v2/{user}/trips/{trip}/days/{slug}/media` with
`visibility: "private"` (or `"guest"`) answers 404 at its `/media/...` URL
for a reader who is not entitled to it, the same as an equivalent v1 gallery
item already does.


## Closed 2026-09-13 — not a bug, and the evidence

This was captured on the reading that `labelOf`
(`app/[user]/media/[...path]/route.ts`) "scans only v1 markdown entries", so a
`visibility: private` photograph on a v2 day would be served to anyone who
guessed its URL. **That is not what happens.**

`labelOf` reads `getAllEntries(ref, AS_AUTHOR)` — and since B1598
`getAllEntries` *is* the v2 reader. Its projection
(`lib/entries.ts`) maps each `day.media` item into the gallery shape carrying
`visibility: parsePhotoVisibility(item.visibility)`, which fails **closed**: a
word the code does not recognise reads as `private`, never as "no label".

Checked rather than reasoned about: `test/entry-visibility.test.ts` imports the
real `GET` from `app/[user]/media/[...path]/route.ts` and drives it against
fixtures that are v2 JSON like everything else since B1598. 47 tests pass,
including the held-back-day case whose own comment records B327 and B632 —
"the words hidden and the pictures not" — which is precisely this failure mode.

So both halves AGENTS.md requires are intact: `visible()` strips the item from
every reading path, and the media route refuses the file.

**Kept rather than deleted, because the reasoning is worth finding.** An agent
reading `lib/api/v2/media.ts` alone would reach the same wrong conclusion — that
file genuinely knows nothing about days. What makes the gate work is one level
up, in a reader whose name does not say "v2". Anyone who rediscovers this
should land here rather than spend an afternoon on it, or worse, "fix" a
protection that already holds.
