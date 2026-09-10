---
id: B1227
title: The receipt names two files and a missing print account, and neither the format nor the cover
type: ISSUE
priority: high
complexity: low
area: photobook, mail
found: "2026-09-10T05:30:00Z"
started: "2026-09-10T05:08:47Z"
merged: "2026-09-10T05:14:21Z"
---

# B1227 — The receipt names two files and a missing print account, and neither the format nor the cover

## Why

The mail an owner gets after building a book, in full:

> **Danke — dein Fotobuch ist fertig**
> Algarve 2026, 46 Seiten. *Innenteil und Umschlag sind getrennte Dateien, so
> will es eine Druckerei.*
> 40 Credits. Du hast noch 703.
> Herunterladen — book-interior.pdf / book-cover.pdf
> *Es wurde nichts gedruckt und nichts verschickt. Diese Instanz hat noch kein
> Druckkonto — die Dateien gehören dir.*

Three things wrong with it now:

- **"Innenteil und Umschlag sind getrennte Dateien"** — since B1205 the book is
  one PDF with the cover as page 1, which is what the printer actually wants.
- **"Diese Instanz hat noch kein Druckkonto"** — false since Gelato was
  connected. B1156 was the same sentence on the order panel; this is its twin,
  and it survived because nobody read the mail.
- **It never says what was bought.** Not the size, not the cover. "46 Seiten"
  is the only fact about the object, and the two things a person would check
  against a delivery — 20 × 20 cm, softcover — are absent.

## Work

- Name the cover and the format in the body: trip, pages, cover, size.
- Say it is one file, since it is.
- The "nothing was printed" sentence becomes conditional on this instance
  actually being unable to print — the same question `/api/health` answers.
  Where a book *was* sent to the printer, the order page is what carries its
  status, and the receipt should not contradict it.

## Acceptance

- The mail names the size and the cover.
- It describes one file when one file is what was made.
- It does not claim there is no print account on an instance that has one.
- `npm run verify`, and a real mail read end to end.
