---
id: B1750
title: Nobody knows whether a phone's bulk photo upload keeps its EXIF, how many it survives, or whether a PWA can finish one in the background
type: OPS
priority: high
complexity: low
area: photos, uploads, pwa
found: "2026-09-14T19:43:33Z"
---

# B1750 — Nobody knows whether a phone's bulk photo upload keeps its EXIF, how many it survives, or whether a PWA can finish one in the background

## Why

B1751 proposes a service whose whole value rests on three assumptions about
phones nobody here has tested:

1. **That metadata survives.** If Safari on iOS strips EXIF when a photograph
   is picked through `<input type="file">` — or hands over a re-encoded JPEG
   instead of the HEIC original — then there is no GPS, no timestamp and no
   camera, and the guided import has nothing to place a day with. That is the
   difference between a service worth building and a photo uploader.
2. **That a bulk selection actually goes through.** "Twenty days of photos" is
   several hundred files and several gigabytes. Nobody knows what iOS and
   Android do at that size: how many the picker will hand over at once, what
   happens when the screen locks mid-upload, whether the request dies.
3. **That a PWA can finish it in the background.** There is a service worker
   at `public/sw.js` and a manifest at `app/manifest.ts`, but Background Sync
   and Background Fetch are not implemented on iOS Safari as far as anyone
   here has checked. If the upload only runs while the tab is foregrounded,
   the flow has to be designed around that instead of pretending otherwise.

Answering these costs a day. Getting them wrong costs the feature.

## Work

An engagement, not a diff. Run against a real iPhone and a real Android phone,
pointed at a local checkout or the live instance, and write down what actually
happened — a claim from documentation is not an answer here.

- Upload via `<input type="file" multiple accept="image/*">` from iOS Safari
  and from Chrome on Android. For each: is EXIF intact (GPS, `DateTimeOriginal`,
  make/model), is the file the original or a re-encode, is HEIC preserved?
  Compare against `lib/ingest/exif.ts`, which already reads this and is the
  code that will consume it.
- Repeat from an installed PWA (added to home screen) — iOS in particular
  behaves differently there.
- Find the ceiling: 20 files, 200, 1000. Record what the picker refuses, what
  the browser refuses, what the server refuses (`REQUEST_MAX_BYTES` in
  `lib/validate/media.ts`), and how long a realistic batch takes on mobile
  data.
- Background: does the upload survive backgrounding the tab, locking the
  screen, switching apps? Test Background Sync / Background Fetch where
  present and record the honest support matrix for iOS and Android.
- Check whether an Android picker can hand over a whole album, and whether
  either platform exposes an album or date range at all through the web —
  B1751 assumes "select an album or 20 days" and that assumption needs a yes
  or a no.
- Also worth an hour: the Photos-app share sheet and the PWA share target, in
  case that is a better door than a file picker.

Write the findings into this ticket. Anything that turns out to be broken or
missing becomes its own backlog ticket; do not fix things here.

## Acceptance

- This ticket, when closed, answers each of the three questions above with an
  observation — a file, a screenshot, a number — rather than an expectation.
- B1751's Work section can be written or corrected from the findings without
  guessing at a platform's behaviour.
- The size ceiling is a number, per platform, with the failure mode named.

## Related

B1751 is the feature this gates.
