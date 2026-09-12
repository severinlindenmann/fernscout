---
id: B1564
title: attach_files leaves photos listed as unrecorded after filling the gallery
type: ISSUE
priority: medium
complexity: low
area: helper, content
found: "2026-09-12T07:31:45Z"
started: "2026-09-12T07:36:46Z"
session: 47912984-b51b-4d11-b25e-5b026ba593de
claimed: "2026-09-12T07:36:46Z"
---

# B1564 — attach_files leaves photos listed as unrecorded after filling the gallery

## Why

Live day `severin/daily-updates-2026/2026-09-11` (written this morning via
the helper): its frontmatter says `unrecorded: [costs, coordinates,
photos]` while its `gallery:` holds two photographs. The file claims both
"nobody knows whether there were photos" and "here are the photos" at
once.

The publish-time question rows wrote `photos: unknown` (`unrecorded`), and
the later `attach_files` press appended gallery items without retracting
it. `lib/api/entries.ts:1350` already implements the retraction rule (B531,
B560: an edit that supplies what a day was missing clears the decline) for
the edit path — the gallery-append path never runs it.

## Work

Root cause, not symptom: wherever gallery items are appended to an entry
(the route behind `attach_files` / the media upload's day-attach), drop
`photos` from both `unrecorded:` and `without:` — a gallery item *is* the
answer, same as `lat`+`lng` arriving clears `coordinates`
(lib/api/entries.ts:1368). Check every caller that appends gallery items so
each path gets it.

## Acceptance

Attaching a photo to a day whose frontmatter says `unrecorded: [photos]`
(or `without: [photos]`) leaves the file with a gallery and without
`photos` in either list. A test that fails today. `npm run verify` green.
Also: fix the live day's frontmatter after deploy.
