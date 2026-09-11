---
id: B1539
title: Ten days on one island shared one media folder and one slug, and two thirds of the photographs were lost
type: ISSUE
priority: high
complexity: low
area: helper, content
found: "2026-09-11T18:30:00Z"
---

# B1539 — Ten days on one island shared one media folder and one slug, and two thirds of the photographs were lost

## Status — fixed in fernscout-helper

**Fixed and committed** on 2026-09-11 in `build.mjs`: repeated slugs are
numbered (`phuket-island`, `phuket-island-2`, …), the media folder is named from
the resulting unique slug, and the entry filename keeps its date prefix.

Filed after the fact, because nothing recorded a data-loss bug that had
presumably been shipping for as long as `build.mjs` has existed.

## Why

Found while importing a 23-day trip. `build.mjs` reported *"21 entries, 177
photos"* and had written **111 files**.

The entry filename carried the date — `2025-09-01-phuket-island.md` — and was
therefore unique. The media folder was slugged from the day's **place alone**:

```js
const daySlug = slug(place) || "day";
const mediaDir = join(TRIP, "media", daySlug);
```

A trip that stays put breaks that immediately. Ten of the twenty-one days were
on Phuket, so ten days all resolved to `media/phuket-island/` and wrote
`01.jpg … NN.jpg` over each other in turn. The last day to be written won. Every
earlier day's gallery pointed at that day's photographs — the right filenames,
somebody else's pictures — and two thirds of the export never reached the
journal.

**Nothing failed.** No error, no warning; the count printed is the count
*intended*, not the count written. It was caught by chance, by looking at
`find media -name '*.jpg' | wc -l` for an unrelated reason.

The same root cause bit a second time one step later: the instance derives a
day's identity from its slug, so ten days claiming `phuket-island` were refused
with `409 duplicate slug` — which is at least loud.

## Work

Done. Worth considering beyond the fix:

- **`build.mjs` should verify what it claims.** It prints a file count it
  computed rather than one it counted. Counting the files actually on disk
  afterwards, and refusing to agree with itself when they differ, would have
  turned this into a failed run instead of a quiet loss.
- **`validate-content` cannot see this either** — a gallery whose `src` files all
  exist is valid, even when ten days share them. Two days whose galleries
  resolve to the same folder is a folder-level question, which is exactly the
  half the helper keeps for itself.

For the journal that found it, the fix meant renaming every entry and media
folder to a hand-chosen slug (`2025-08-30-elefanten`,
`2025-09-11-jetski-tour`) and re-running. There was no automatic remedy, because
the overwritten pixels were gone — only the export directory still held them.

## Acceptance

- A trip with ten days in one place writes ten distinct media folders.
- The photograph count `build.mjs` prints matches the files on disk, or the run
  fails.
- Re-running on an existing content folder does not silently change which
  photograph a gallery entry points at.
