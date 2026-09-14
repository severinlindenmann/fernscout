---
id: B1750
title: Nobody knows whether a phone's bulk photo upload keeps its EXIF, how many it survives, or whether a PWA can finish one in the background
type: OPS
priority: high
complexity: low
area: photos, uploads, pwa
found: "2026-09-14T19:43:33Z"
started: "2026-09-14T20:11:36Z"
session: 0e7f2abd-d7ef-4dd2-9733-1fd412b78b47
claimed: "2026-09-14T20:11:36Z"
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

Still unanswered: all three original questions. Nothing has yet been observed
about EXIF survival, the selection ceiling, or background behaviour.

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
