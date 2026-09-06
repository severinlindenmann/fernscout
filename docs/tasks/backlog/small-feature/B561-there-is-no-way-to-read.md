---
id: B561
title: There is no way to read the finished book before paying, and the preview is small and misaligned
type: FEATURE
priority: high
complexity: medium
area: photobook, composer, ux
found: "2026-09-06T10:56:06Z"
---

# B561 — There is no way to read the finished book before paying, and the preview is small and misaligned

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Four complaints from the person this is for, all about the same thing: the
preview is a strip you glance at, and there is no moment where you *read the
book* before spending money on it.

- **No way to see the whole thing.** After arranging it, the only view is the
  swipe strip. Ordering is a leap: you have never seen the book end to end.
- **Too small on a phone**, and it does not command the screen.
- **The spacing is wrong** — the strip has room below it and none above, so the
  top of the page is flush against what precedes it and the composition looks
  broken. Visible in the screenshot attached to the request.
- **On a desktop nothing says the arrow keys work.**

## Work

**A way to read the book.** A "Preview" step reached deliberately after
arranging and before ordering: the whole book, page after page, at the largest
size the screen allows — a gallery rather than a strip. It is the last thing
somebody does before paying and it should feel like holding the book.

Spreads, not single pages: B514 established that a bound book is read as facing
pages and it caught B518 the same day.

**Fix the strip while you are there:** symmetric spacing above and below, and
larger on a phone. It is the first thing on the screen (B548) and should behave
like it.

**Tell a desktop reader the keys work.** Only where a keyboard exists — a hint
about arrow keys on a phone is noise. If the keys do not currently work,
make them.

**Not doing:** zoom, rotation, or a page-by-page thumbnail index. The book is
short; scrolling it is enough.

## Acceptance

- From the composer, one action leads to the whole book read end to end, and
  from there to ordering.
- The strip has equal space above and below.
- On a desktop, the arrow keys move through the book, and the page says so.
