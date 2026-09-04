---
id: B318
title: A draft day shows three of its nine photographs and all nine once published
type: ISSUE
priority: high
complexity: medium
area: media, viewer
found: "2026-09-04T16:55:51Z"
started: "2026-09-04T16:57:40Z"
merged: "2026-09-04T17:05:24Z"
---

# B318 — A draft day shows three of its nine photographs and all nine once published

## Why

Reported by the owner on 2026-09-04, after an agent uploaded nine photographs
across the days of a trip: *"for some reason only 3 pictures are shown in draft
mode but after publish all are shown."*

So the files are on disk and the frontmatter is right — publishing changes
nothing about the media, only whether `status: draft` is on the entry. Which
means a reading path used for the owner's own view of unpublished content is
returning a different set of tiles than the published one.

The leading suspect, not confirmed: `getAllMedia` (`lib/entries.ts:389`) takes
`ReadOptions` and passes them to `getAllEntries`, which filters drafts out
unless `includeDrafts` is set. A caller that omits it sees only published
days' media. B296 found exactly this shape of bug one endpoint over — the days
listing hiding drafts from the caller entitled to see them — so a second
instance is plausible rather than surprising.

What that hypothesis does **not** explain is *three*. A path with no
`includeDrafts` would show zero from a trip whose days are all drafts, not
three. So either some days were already published when the owner looked, or
the count comes from somewhere else — a derivative that had not finished being
written, a gallery limit on a preview component, or two different components
disagreeing. **Establish which before fixing anything**; the number is the
clue.

## Work

1. **Reproduce it.** A trip with several draft days, several photographs each,
   viewed by the signed-in owner. Note exactly which page was wrong — the
   day page, the trip's gallery page, the trip page's own strip — because the
   owner's report does not say and the three have different callers.
2. **Enumerate the callers** of `getAllMedia` and of anything else that reads
   `entry.gallery`, and check each for `includeDrafts` and for a slice or cap.
   B265 and B296 were both "one call site out of nineteen", and both were
   found by listing them rather than by reasoning about them.
3. Fix the one that is wrong. **Do not change the default** —
   `visible()`/`getAllEntries` filtering drafts is what keeps unpublished
   writing off the public site, and B296's rule holds: pass the option at the
   call site that is entitled to it, never widen the default.
4. A test that a signed-in owner sees every photograph of a draft day, and a
   test that a stranger sees none of them. The second matters more.

## Acceptance

- An owner looking at their own draft day sees all of its photographs.
- No public reading path — page, feed, sitemap, search, gallery — shows a
  draft's media; asserted by a test.
- The report's "three" is explained in the ticket or in a code comment, so the
  next person knows whether it was this bug or a second one.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
