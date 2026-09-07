---
id: B683
title: Uploading photographs from a phone fails halfway with no resume
type: FEATURE
priority: high
complexity: high
area: media, mobile
found: "2026-09-07T09:52:58Z"
started: "2026-09-07T11:18:11Z"
merged: "2026-09-07T11:43:58Z"
---

# B683 — Uploading photographs from a phone fails halfway with no resume

## Why

B674 named it and this is the case: uploading forty photographs from a phone
browser over a hotel connection fails halfway, with no resume. It is the least
recoverable failure in the product, and B682's wizard makes it the most
common one.

Originals are already kept — `lib/api/media.ts` writes every upload to
`originals/`, which is what the photobook prints from — so nothing about
storage changes. What is wrong is the transfer: the phone pushes 50MB HEICs
and the day is unusable until the last one lands.

## Work

Plan §7.

- **Two phases.** The browser downscales to 2000px (the width the pipeline
  already targets) and uploads that first, so the day is readable in seconds.
  The untouched original follows in the background against the same item.
- One server change: an upload that attaches an original to an existing media
  item. That is the only new capability in the media path.
- Sequential queue with backoff, per-file progress, resume across a killed tab.
  The inbox already names files by a hash of their bytes, so a re-picked
  photograph is recognised rather than duplicated.
- `lib/storageQuota.ts` is checked **before** the queue starts — no wall at
  photograph 39.
- Anything that is not media goes to the inbox rather than being refused
  (`lib/inbox.ts`), which is what makes B689 cheap later.

Not doing: a chunked byte-range protocol. Add it if a 4K video proves the
simple queue insufficient.

## Acceptance

Forty photographs picked on a phone over a throttled connection: the day is
readable before the originals finish, the tab can be killed and resumed, no
duplicates, and `originals/` ends up with all forty at full resolution.
