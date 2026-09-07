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
