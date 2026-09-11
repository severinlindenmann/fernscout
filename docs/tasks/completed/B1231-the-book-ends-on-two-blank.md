---
id: B1231
title: The book ends on two blank pages instead of the colophon
type: ISSUE
priority: medium
complexity: low
area: photobook, print
found: "2026-09-10T05:05:00Z"
merged: "2026-09-10T05:31:00Z"
---

# B1231 — The book ends on two blank pages instead of the colophon

## Why

B1173 added the two blank leaves Gelato counts and put them at the very end,
on the reasoning that the end is the only placement that cannot disturb a
spread. Gelato's preview then showed what that means:

```
page 43   colophon
page 44   blank
page 45   blank
```

A book that ends on blank paper reads as though the printer ran out, and the
colophon — the one page saying who made this and when — stops being the last
thing anybody sees.

The reasoning behind "put them at the end" was half right. What it protects
against is a spread the planner paired printing across a turn, and that only
happens when the pages after the insertion change sides. **Two is even**, so
inserting two anywhere leaves every later page on the same side of its leaf.
One leaf would have turned the whole book over; two does not.

Reported by the owner from the Gelato preview, with the fix in their own
words: *"in the case 1 page is missing we generate 1 white behind the last one
then the last one comes."*

## Work

- Draw every page but the last, then the two leaves, then the last page.
- The count is unchanged and still `pageCount + 2` interior, which is what
  Gelato requires.
- A one-page volume has nothing to put them in front of and keeps them after.

## Acceptance

- The last page of the book is the colophon.
- The two blank leaves are the two before it.
- Gelato's "at least one page is empty" warning still appears, and should — a
  blank leaf at the back of a book is ordinary, and the alternative is failing
  their page count, which is not a warning.
- `npm run verify`.

## Evidence

Built from `severin/algarve-2026` after the change and rendered page by page:

```
page 43   345 bytes   blank
page 44   345 bytes   blank
page 45  2767 bytes   COLOPHON — "Algarve 2026 · Written and photographed by
                      Severin & Viktória Zentai", with the two figures
```

Shipped in commit `57ceab9e`, which cites this as B1206 — an id that belongs to
a different ticket in another session. `lib/photobook/render.ts` now cites this
one.
