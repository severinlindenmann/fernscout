---
id: B527
title: After a partly-failed media batch an agent cannot tell which photographs landed
type: FEATURE
priority: medium
complexity: medium
area: api, media upload
found: "2026-09-05T21:30:00Z"
started: "2026-09-05T21:20:43Z"
session: 5813be44-d8aa-40f5-ab31-affc7af3746a
claimed: "2026-09-05T21:20:43Z"
---

# B527 — After a partly-failed media batch an agent cannot tell which photographs landed

## Why

A batch is all-or-nothing per request, which is right and is not the problem.
What is missing is any way to find out afterwards **what landed**. Reading a
day back gives server-assigned names in position order:

```json
"gallery": [{"src": ".../01.jpg", "width": 1500, "height": 2000}, …]
```

`kept.filename` — the one field that echoes what the client called the file —
appears in the upload response and nowhere else (`lib/api/media.ts:45`). The
original on disk is renamed `NN.ext` too, so the name is not recoverable from
the folder either.

So after a run where some batches succeeded and others failed — which is what
B523 guaranteed would happen — an agent knows how many photographs a day holds
and not which. Resuming by count duplicates some files and silently drops
others. The reporting run only recovered because it kept its own per-file log
and could reconcile arithmetically. That is luck, not a supported path.

## Work

- Record the source filename on the gallery item: `from:` beside `caption:` in
  the day's `gallery:` frontmatter (`lib/ingest/entry.ts:57` writes those
  lines, `lib/entries.ts` parses them, `lib/types.ts` declares them). Set it in
  `storeUploads`, and let ingest set it too — it has the same information and
  the same reconciliation problem.
- It then comes back on `GET .../days/<slug>` and in the `.md` twin for free,
  which is where an agent already reads a day back to verify.
- Say in the guide that a resume is a read of the day and a comparison of
  `from:`, not a count.

Not doing: `idempotency_key` per file. `from:` answers the question with a
field the content model already has a shape for, and a key would be a second
identity for the same file.

Worth naming: a camera filename becomes visible in a published day's markdown
twin. `IMG_4821.JPG` carries nothing personal, and the alternative — a sidecar
nothing renders — is a second source of truth about a folder people edit by
hand.

## Acceptance

- Uploading `IMG_4821.JPG` and reading the day back returns
  `"from": "IMG_4821.JPG"` on that gallery item.
- A day written before this exists reads back without `from` and renders
  unchanged.
- `npm run verify` green.
