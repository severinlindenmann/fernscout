---
id: B1572
title: A long inbox document filename pushes the Dateien tab into horizontal scroll
type: ISSUE
priority: medium
complexity: low
area: agent room, mobile
found: "2026-09-12T08:54:16Z"
---

# B1572 — A long inbox document filename pushes the Dateien tab into horizontal scroll

## Why

Reported directly: on `/agent` (mobile), opening the "Dateien" tab with a
long inbox filename — the example given was an account statement CSV —
makes the whole tab "not locked in anymore", scrolling sideways.

`InboxFileGroups.tsx:174-199` renders each document as an `<li className="flex
items-center gap-1">` containing a `<label className="flex min-h-11 flex-1
cursor-pointer items-center gap-2 …">` and a delete button. The filename
itself is `<span className="block truncate …">{file.name}</span>` at line 189,
nested two levels inside the label — but `truncate` (`overflow: hidden` +
`white-space: nowrap` + `text-overflow: ellipsis`) only clips when its own box
is already width-constrained, and nothing here constrains the `<label>`.

A flex item's default `min-width` is `auto`, which for text content resolves
to the content's *minimum* intrinsic size — and because the filename span is
`white-space: nowrap`, that minimum is the whole unbroken filename, not a
single character. `min-w-0` is set on the inner text-wrapping span
(`InboxFileGroups.tsx:188`, `<span className="min-w-0 flex-1">`), but **not**
on the `<label>` that is the actual flex child of the `<li>` — so the browser
refuses to shrink the label below the width the full filename needs, which
pushes the `<li>`, the `<ul>`, and the whole "Dateien" section wider than the
viewport. That is the classic flexbox truncation trap, and it is exactly why
it reads as "the tab is not locked in": the section itself gained width and
started scrolling sideways, rather than the text being visibly cut off.

The photo grid two sections above (`InboxFileGroups.tsx:110-151`) does not
have this bug: it is CSS grid with Tailwind's `grid-cols-3` (`repeat(3,
minmax(0, 1fr))`), and the explicit `minmax(0, …)` already overrides the same
default auto-minimum that trips up the flex row below it.

## Work

- `InboxFileGroups.tsx:177` — add `min-w-0` to the document row's `<label>`
  className, so the label (the actual flex child) can shrink to the row's
  available width and hand `truncate` something to clip against.
- Leave the photo grid (lines 110-151) alone — it is unaffected, per the Why
  section above.

## Acceptance

- On a phone-width browser, add (or use test fixture data for) an inbox
  document whose filename is much longer than the "Dateien" tab's width, open
  the tab, and confirm the row's text is ellipsised and the tab does not
  scroll horizontally — check `document.documentElement.scrollWidth ===
  document.documentElement.clientWidth` as well as looking at it, per the
  `browser-testing` note that a `--screenshot`-only check can miss exactly
  this class of bug.
- `npm run verify` passes.
