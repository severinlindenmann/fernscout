---
id: B873
title: A video on a day is dropped from the captions with no mention
type: ISSUE
priority: low
complexity: low
area: agent, media
found: "2026-09-07T17:37:28Z"
started: "2026-09-08T20:33:49Z"
merged: "2026-09-08T20:51:23Z"
---

# B873 — A video on a day is dropped from the captions with no mention

## Why

On a day holding two photographs and one video, `describe-photos` answers with
**two caption rows for a three-item gallery** — no row for the clip, no note,
no mention.

A video-only day is handled properly: `{"error":"no_photos"}`, 400, no credit
spent. It is the mixed day that is quiet.

Not describing the video is right — nothing should be invented from a poster
frame. Saying nothing about it is the fault: a person looking at three tiles
and two captions has no explanation, and an agent matching captions to items by
position could pair the wrong text with the wrong picture.

Found by the caption audit, 2026-09-07.

## Work

Confirmed still real, 2026-09-08: `app/api/helper/[user]/day/describe-photos/route.ts`
built `bySrc` from `entry.gallery.filter((item) => item.type === "image")`
alone — a video was never in that array, so it never got a row.

Fixed by keeping the gallery-index alongside each photograph
(`photoEntries = gallery.map((item, index) => ...).filter(type === "image")`,
`route.ts:82-89`) so the response can be built from the *whole* gallery
(`route.ts:130-139`) rather than only the photographs. A gallery item that is
not an image now gets `{ src, caption: "", skipped: "video" }` — chose an
explicit `skipped` marker per row over a separate `skipped` list, since the
caller (`components/AgentWizard.tsx`) already renders one row per `src` and a
marker on the row itself is one fewer thing to cross-reference. The
`no_photos` 400 for a video-only day, and the credit/model call covering only
photographs, are unchanged (`photoEntries.length` in place of the old
`photos.length` throughout).

`components/AgentWizard.tsx`: `PhotoCaption` gained `skipped?: "video"`; a
`skipped === "video"` row renders `t("agent.captionVideo")` ("Videos are not
described.") instead of the caption, and hides the "Use" button, since there
is nothing to keep. New key added to all three locales
(`site/locales/{en,de,hu}.json`) and `lib/i18n.ts` regenerated with
`npm run i18n:keys`.

This route is under `/api/helper/`, not `/api/v1/` or `/api/auth/`, so the
`/openapi.json` contract rules in AGENTS.md do not apply to it — it is the
web helper's own internal API, undocumented there like its neighbours.

Not touched: **B708** (a day of videos hits the per-day item limit early) and
**B670** (`kept` in the media upload response omits video originals) are a
different route (`/api/v1/.../media` upload) and a different symptom
(counting/kept-list, not captioning); this fix does not overlap either.

## Acceptance

- Every item on the day is accounted for in the answer, described or
  explained. Verified: `test/helper-describe-photos.test.ts`, describe block
  "a mixed day — B873" — a day with 2 photographs + 1 video gets 3 caption
  rows, the video row is `{ src, caption: "", skipped: "video" }`, and
  `describePhotos` is called with exactly the 2 photographs (1 credit spent).
  Confirmed the test fails against the pre-fix route (2 rows, not 3) and
  passes after.
- Video-only day still refused before any spend: unchanged, existing test
  "a day with no photographs is refused before any spend" still passes.
- `npm run verify`: build → tsc → eslint → 5772 tests passed, 4 skipped →
  knip clean. Exit code 0, no known-noise failures hit.
