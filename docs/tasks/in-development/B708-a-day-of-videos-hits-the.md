---
id: B708
title: A day of videos hits the per-day item limit early
type: ISSUE
priority: low
complexity: low
area: api, media
found: "2026-09-07T11:17:10Z"
started: "2026-09-07T11:40:34Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:34Z"
---

# B708 — A day of videos hits the per-day item limit early

## Why

`lib/api/media.ts:212` counts what is already in a day with
`fs.readdirSync(mediaOut).length` and measures it against `itemsPerDay`. That
directory holds *derivatives*, not items: a video leaves a poster frame beside
it, and a second format leaves another file. So a day of clips reaches the
per-day ceiling well before it has that many things in it, and the person is
told they have too many photographs when they have not.

Found while building B682.

## Work

Count items rather than files — the gallery in the day's own frontmatter is the
list that means something. Check `lib/photos.ts` for what already knows how to
enumerate them.

## Acceptance

A day holding ten videos counts as ten items, not thirty, and the limit refuses
at the right number. A test with a video fixture asserts it.

## Resolution

`lib/api/media.ts` — `storeUploads` now reads `existing` from the entry's own
gallery (`entry.gallery.length`, off `getEntryBySlug`, which it already calls
to check the day exists) instead of `fs.readdirSync(mediaOut).length`. The
gallery frontmatter is what "item" means everywhere else on a day (the day
page, `story.json`, this same ceiling's own error message), and it is
unaffected by however many derivative files one item leaves beside it.

Test: `test/media-upload.test.ts` — added "a day of videos counts items, not
the poster and format files beside them," which attaches three video gallery
items with two files each (six files on disk) under an `itemsPerDay: 5`
config and asserts a fourth upload still has room. Confirmed it fails before
the fix (six files trips the old file-counting ceiling) and passes after.

Also rewrote the neighbouring "per-day ceiling" test, which used to call
`storeUploads` in a loop without ever calling `attachGallery` — a fixture that
happened to only exercise the old, file-counting behaviour and would have
falsely reported the day as always full under the new, gallery-counting one
had it been left unattached. It now attaches each upload, matching what the
route (the only production caller) actually does.
