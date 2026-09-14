---
id: B1750
title: Nobody knows whether a phone's bulk photo upload keeps its EXIF, how many it survives, or whether a PWA can finish one in the background
type: OPS
priority: high
complexity: low
area: photos, uploads, pwa
found: "2026-09-14T19:43:33Z"
started: "2026-09-14T20:37:43Z"
merged: "2026-09-14T20:43:39Z"
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

## Revalidated 2026-09-14 — valid

The premise is a knowledge gap rather than a defect, so there is nothing in the
code that could have fixed it. Confirmed instead that the consumer exists and
is ready for the answer: `lib/ingest/exif.ts:480` (`readExif`) already parses
JPEG APP1, HEIC `meta` and WebP `EXIF` for exactly the four things an import
needs, and `lib/inboxUpload.ts:1` is the multipart door it sits behind. What is
missing is any observation of what a phone actually hands them.

## Scaffolding built on this branch

The questions cannot be answered by describing them to somebody holding a
phone. So this branch adds a throwaway probe, small enough to delete in one
commit once the findings are written:

- `public/probe.html` — a plain page, no route, no username shadowed. It
  reports the platform's own support matrix (service worker, Background Sync,
  Background Fetch, Periodic Sync, standalone/PWA), lets the person pick as
  many photographs as the picker allows, uploads them in batches of 20, and
  logs on screen what the server found in each batch: how many carried GPS,
  how many carried a timestamp, which containers arrived. A failure mid-run is
  logged with the count it reached, because that is question 2's answer.
- `app/api/probe/upload/route.ts` — reads each file with `readExif`, records
  the container from the file's own first bytes (a `jpeg` under a `.HEIC` name
  is Safari re-encoding on the way out, which is where EXIF dies), keeps the
  original, and writes a JSON report beside it.

Deliberately **not** a capability in `lib/config.ts`. It is gated on
`PROBE_TOKEN` in the environment matching `?k=`, and answers 404 when the
variable is absent — so it does not exist on any instance that has not switched
it on, and `FEATURE_NAMES` does not gain a permanent entry for a temporary
thing.

Uploads land in `PROBE_DIR` (default `/tmp/fernscout-probe`), outside
`content/` and outside the storage quota, and a sweep on each request deletes
run directories older than 48h. That is B1751's temporary store in its POC
form; a probe does not earn a scheduler.

**This is scaffolding, not the deliverable.** The ticket is closed by findings
written into the section below, and by deleting these two files.

## Findings

### Run 1, 2026-09-14, iPhone (iOS 18.7), Safari 26.6.1 and Brave 26.6.2 — no data

Thirty photographs selected in each browser. Both reported `Load failed` and
nothing arrived. **Not a phone finding — the probe's own deployment was wrong.**

`journalctl -u fernscout` showed the request reaching Next and then
`Error: aborted` one to three seconds in, three times, once per attempt. The
cause is `deploy/fernscout.caddy`: `/api/probe/upload` matched neither
`@bigbody` nor `@transcribe`, so it fell into `@smallbody`'s **10 MB**, and
Caddy closed the connection partway through a batch of thirty phone
photographs. `fetch` rejects with a bare `TypeError` when the connection closes
rather than answers — `Load failed` on Safari, `Failed to fetch` elsewhere —
so there is no status to report and it is indistinguishable from the signal
dropping on a train.

The comment above that matcher list already says to keep it in step with the
routes that call `request.formData()`, and it was still missed. Fixed by adding
the probe path to `@bigbody` and excluding it from `@smallbody`; the line goes
when the probe does.

Worth keeping for B1751: the real import doors are already on the 520 MiB tier,
so this is a probe bug rather than a bug the feature would inherit. What the
feature does inherit is the failure *shape* — a proxy refusing a body size and
a lost connection are the same event to the page, and an import that shrugs
"Load failed" at somebody halfway through three hundred photographs is not good
enough. B1751 needs per-file or per-batch resumption and an error that names
which it was.

Also changed: the page now logs each batch's size in MB before sending, and
says explicitly when a failure carried no HTTP status. Batch size dropped from
20 to 10 — a batch is one request with no progress of its own, so a large one
on mobile data is a long silence.

### Run 2, 2026-09-14, iPhone (iOS 18.7 / build 26.5), Safari — 36 files, all arrived

36 selected, 36 delivered, in four batches of 10/10/10/6. Nothing was refused
and nothing was truncated. 34 images and two `.mov` clips, spanning 2026-07-02
to 2026-07-11 — a real ten-day stretch, not a fixture.

**Q1, does EXIF survive: yes, completely — but the file is not the original.**

The 22 camera-original images arrived with 157 EXIF tags each, Apple MakerNotes
intact: `Make`, `Model`, `LensModel` ("iPhone 15 back dual wide camera 5.96mm
f/1.6"), `DateTimeOriginal` with `OffsetTimeOriginal`, full GPS including
`GPSAltitude` and `GPSHPositioningError`, `ContentIdentifier`, `HDRGain`,
`FocusDistanceRange`. Full resolution, 5712×4284. Safari strips nothing.

What it does do is **re-encode**. Every file arrived as `image/jpeg` with a
JFIF header, from a phone that shoots HEIC, and — the decisive part — **every
file's `lastModified` is the moment of upload**, not the moment of capture:

```
IMG_5616.jpeg   lastModified 2026-09-14T22:25:48   exif takenAt 2026-07-11T10:07
IMG_5615.jpeg   lastModified 2026-09-14T22:25:48   exif takenAt 2026-07-11T10:06
```

iOS generated those files during the pick. Two consequences, both load-bearing
for B1751:

1. **There is no print master to keep.** AGENTS.md requires an upload to keep
   its original, and over this door the original never leaves the phone. A
   web-quality JPEG is what arrives. Either B1751 accepts that and says so, or
   the flow needs a second path for the original; it cannot quietly claim to
   hold a master it does not have. *(Not yet separated: whether this phone is
   set to capture HEIC and Safari converts, or captures JPEG outright —
   Settings → Camera → Formats answers it in one look. The `lastModified`
   evidence says a file was generated either way.)*
2. **File mtime is not a fallback here, it is a wrong answer.**
   `lib/ingest/index.ts:230` falls back `exif.takenAt ?? probe?.takenAt ??
   fromDate(stat.mtime)`, and `lib/ingest/exif.ts:22` describes mtime as
   "usually close enough for anything straight off a card". Straight off a
   card, yes. Off a phone through a browser, mtime is *today* for every file in
   the selection, so the fallback silently dates a 2019 trip to the day it was
   imported. B1751 must not use it; a file with no capture time should be
   placed from its neighbours or left for the person to answer.

**Q1b, the files without GPS were never ours to lose.** 14 of 36 carried no
position, and the split is clean rather than random:

| | count | filenames | Make/Model | GPS |
| --- | --- | --- | --- | --- |
| Camera originals | 22 | `IMG_####.jpeg` | Apple iPhone 15 / 12 Pro | yes, all 22 |
| Saved from elsewhere | 12 | UUID `.jpeg` | absent | none |
| Clips | 2 | `IMG_####.mov` | (see below) | not read |

Every UUID-named file is progressive-DCT JPEG with IPTC and a Photoshop
`IPTCDigest`, no `Make`, no `Model`, no MakerNotes — and it keeps
`DateTimeOriginal` and `OffsetTime`. That is not a camera file: it is an image
saved into the library from somewhere else, already stripped of its camera and
its position before it ever reached this phone. iOS hands such assets a UUID
filename precisely because they have no camera filename. **22/22 camera
originals kept their GPS; 0/12 non-originals ever had any.** Nothing in the
upload path lost a coordinate.

Worth carrying into B1751 as a product fact rather than a bug: in one ordinary
camera roll, a third of the photographs have no location at all, and they will
cluster on the days somebody was sent pictures by the people they were with.
Those days need to be placeable by asking, not by inference.

**The two clips are a real gap, and it is ours.** `lib/ingest/video.ts:183`
asks ffprobe for `format_tags` and reads only the creation date from the
response. `com.apple.quicktime.location.ISO6709` is in that same response and
nothing reads it, so a clip filmed on the same walk gets no position while the
photographs beside it do. Filed as **B1755**. The date half is already right:
`readCreationTime` prefers `com.apple.quicktime.creationdate`
(`2026-07-06T19:35:08+0200`, correct) over the generic `creation_time`, which
on this file is the upload instant — the same export stamp as above. The probe
route itself reports nothing for a `.mov` because `readExif` handles JPEG, HEIC
and WebP only; that is the probe's limit, not the ingest path's.

**Q2, the ceiling: not found.** 36 went through without complaint, largest
single file 33.9 MB (a clip), largest batch about 45 MB. The only failure so
far was the proxy cap in Run 1, which was ours. A run of 200+ would still be
worth doing before B1751 commits to "select an album".

**Q3, backgrounding: not yet tested.** No visibility changes were recorded
during this run, so nothing is known about what happens when the screen locks
mid-upload. Outstanding, along with the standalone/PWA support matrix and any
Android result.

### Run 3, 2026-09-14, same phone — 99 unique files, all delivered

63 more selected on top of the earlier 36, which were re-sent in the same page
session: 135 deliveries, 99 distinct filenames, 15 batches. Nothing was
refused, nothing truncated, no failed batch. 104 stills from the camera, 24
saved from elsewhere, 7 clips. About 494 MB on disk.

**The Run 2 correlation held exactly at three times the sample.** 104 of 104
`IMG_*` camera originals carried GPS. 0 of 24 non-camera stills did. Not one
camera original arrived without a position, and not one saved image arrived
with one. 128 of 135 carried a capture time — the seven without are the seven
`.mov` clips, which the probe route does not read (B1755).

**Q2, the ceiling: still not found.** 99 files went through. The picker handed
over everything selected both times.

**Q2b, the bottleneck is not the network — it is iCloud.** Reported by the
person doing the run and visible in the batch stamps: the fifteen batches span
22:35:14 to 22:36:51, and the gaps between them are uneven in a way transfer
size does not explain — 14s, 5s, 2s, then 15s, 10s, 9s, 23s. Photographs that
are not on the device are fetched from iCloud while the batch is being built,
so the wait is per-file download, not per-byte upload, and it is invisible: the
page shows nothing during it.

That is a finding B1751 has to design around rather than a problem to solve
here. An import of three hundred old photographs — precisely the ones least
likely to be resident on the phone — is largely spent waiting for iCloud, with
no progress to show and an interface that looks hung. It needs its own state
("fetching from iCloud"), and it cannot assume a file handed over by the picker
is available immediately.

**The screen has to stay on, so the page now asks to keep it on.** The other
half of the same complaint: a long run means standing there tapping the phone,
because a sleeping screen backgrounds the tab and iOS suspends a backgrounded
tab's network. `public/probe.html` now takes a `navigator.wakeLock` screen lock
for the duration of an upload, with a checkbox (on by default, disabled with an
explanation where the API is absent). The lock is re-taken on
`visibilitychange`, because the system drops it on hide and does not hand it
back — without that it protects only until the first interruption. `wakeLock`
is now in the support matrix the page reports.

This does not answer Q3. Whether an upload survives being backgrounded is still
unobserved; the wake lock is how somebody avoids finding out the hard way while
answering Q1 and Q2.

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
