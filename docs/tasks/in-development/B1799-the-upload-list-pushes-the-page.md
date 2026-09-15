---
id: B1799
title: The upload list pushes the page wider than a phone viewport
type: ISSUE
priority: high
complexity: low
area: extract, mobile
found: "2026-09-15T13:43:10Z"
started: "2026-09-15T13:43:45Z"
session: 0e7f2abd-d7ef-4dd2-9733-1fd412b78b47
claimed: "2026-09-15T13:43:45Z"
---

# B1799 — The upload list pushes the page wider than a phone viewport

## Why

`components/extract/UploadStep.tsx:209` renders each staged file as

```tsx
<li className="flex items-center justify-between ...">
  <span className="truncate">{tile.file.name}</span>
  <span>{t(STATE_KEY[tile.state])}</span>
</li>
```

`truncate` is `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`,
and it does nothing useful here: a flex child's default `min-width` is `auto`,
so the span refuses to shrink below the intrinsic width of its content. The row
therefore grows to fit the longest filename, the `<ul>` grows with it, and the
page becomes wider than the viewport.

It is invisible with short names and obvious with the ones a phone actually
produces — `43b6b3ee-0e4f-4428-b518-428c79ad7c03.jpg` is a real example from the
owner's own camera roll, beside a status word. On a 390px screen the page scrolls
sideways and the status column sits off the edge.

Reported from a phone with a screenshot showing exactly that. Earlier browser
captures of this feature missed it because they were taken on an empty upload
list, where there are no rows to overflow — a reminder that a capture of the
resting state is not a capture of the working one.

## Work

`min-w-0` on the shrinking child is the whole fix — that is the standard
counterpart to `truncate` inside a flex row, and its absence is why the class
looks applied and does nothing.

While there: check every other list and row this feature added at 390px with
**real content in it**, not an empty state. The day board's cards, the chips
row, and the preview's day list all carry names, dates and counts that vary in
length.

## Acceptance

- At 390px, with a list of files whose names are long UUIDs, the page does not
  scroll horizontally and each row's status stays on screen.
- The filename truncates with an ellipsis rather than wrapping or overflowing.
- Verified in a browser at 390px **with files staged**, capture kept.

## Related

Found alongside B1798 from the same phone screenshot. Independent of it: this one
is layout, that one is colour.
