---
id: B701
title: The low-resolution warning names paths nobody recognises and says a photograph prints soft
type: FEATURE
priority: medium
complexity: low
area: photobook, order page
found: "2026-09-07T00:00:00Z"
---

# B701 — The low-resolution warning names paths nobody recognises and says a photograph prints soft

## Why

B642 rewrote this warning to name the photographs it is about. Read on the
live order page it is still not usable:

> `severin/trips/algarve-2026/originals/vom-ersten-ins-zweite-hotel/08.jpg,
> …/10.jpg, …/13.jpg` werden in dieser Grösse **weich** gedruckt

Two things, both from the owner's side of the screen.

**"Weich" is a printer's word.** So is "soft" in English and "lágyan" in
Hungarian. The person reading has been asked for money and told a thing they
have no word for. Say "slightly blurred", which is what they will see.

**A path is not a photograph.** `08.jpg` in a folder named after a day tells
somebody nothing about which picture it is — and this journal's owner did not
choose those numbers, ingest did. The order page already has a browsable copy
of every one of them: `BookPhoto.webSrc`. Show the picture.

## Work

- Carry `webSrc` on the warning rather than `labelOf()`'s path, and render the
  affected photographs as thumbnails under the sentence
  (`BookLevelView.tsx`, `photosByCode`/`namePhotos`).
  `detail` keeps naming files — that string is the developer's and is not
  rendered.
- Reword `photobook.warn.lowResolution` in all three locales: what happens
  (slightly blurred), how much it matters (still perfectly visible), what to
  do (smaller book, bigger photograph, or leave it). Drop `{photos}` from the
  sentence, since the pictures are now shown rather than named.
- Not doing: a hover preview. A thumbnail that is simply there beats one a
  phone cannot hover over, and it is less code.

## Acceptance

- The warning shows the photographs it is about, as pictures.
- No locale calls a printed photograph "weich", "soft" or "lágyan".

## Findings (2026-09-07)

Built as written. `checkResolution` (`plan.ts`) now puts `photo.webSrc` on the
warning instead of `labelOf()`'s path, and `BookLevelView` renders those as a
row of 48px thumbnails under the sentence (`PhotoRow`, deduplicated and capped
at eight — the row illustrates the sentence, the sentence's own count says how
many there are). `detail` is untouched and still names files: it is the
developer's string and is never rendered.

A photograph with no `webSrc` — only ever a hand-built planner fixture —
carries an empty list, so the warning still counts it and simply shows
nothing. Two tests in `test/photobook.test.ts` pin both halves.

The wording went further than the ticket asked, because the same word was in
three more strings: `photobook.warn.noOriginal` and `postcard.page.lowRes` also
said "weich" / "soft" / "lágyan". All of them now say slightly blurred / less
sharp, in all three locales, and `{photos}` is gone from the sentence since the
pictures are shown rather than named.

**Not verified by eye.** The warning only appears on a real order page for a
trip that actually has an under-resolution photograph, which needs a journal,
the `photobook` and `credits` capabilities and an owner session — so this is
exactly what `testing/` is for: open the Algarve book's order page and look at
the thumbnail row.
