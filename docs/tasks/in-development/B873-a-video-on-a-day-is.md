---
id: B873
title: A video on a day is dropped from the captions with no mention
type: ISSUE
priority: low
complexity: low
area: agent, media
found: "2026-09-07T17:37:28Z"
started: "2026-09-08T20:33:49Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:33:49Z"
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

Return a row for every gallery item, with an empty caption and a reason for the
ones not sent, or return an explicit `skipped` list naming them. Say on the
screen that videos are not described.

## Acceptance

Every item on the day is accounted for in the answer, described or explained.
