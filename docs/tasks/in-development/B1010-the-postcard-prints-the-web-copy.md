---
id: B1010
title: The postcard prints the web copy of the photograph, then warns that it is small
type: FEATURE
priority: high
complexity: medium
area: Postcards
found: "2026-09-08T18:40:00Z"
started: "2026-09-08T18:34:28Z"
session: b8352d66-3105-4f5d-a703-f8809d0b08e6
claimed: "2026-09-08T18:34:28Z"
---

# B1010 — The postcard prints the web copy of the photograph, then warns that it is small

## Why

`orderPhotoFile` in `lib/postcard/send.ts` hands the renderer the file
`resolveMediaFile` returns, which is the **2000px web derivative**. Ingest keeps
the original beside it (`tripOriginalsDir`), and the photobook has printed from
it since B13 — `printSourceFor` in `lib/photobook/source.ts`, whose comment
records that every plate was coming out at about 125 dpi until somebody looked.
The postcard never got that fix.

So the card is printed from a copy made for a web page, and then the preview
tells the owner off about it:

> Dieses Foto druckt mit etwa 244 dpi, unter den 300 dpi, die eine Karte
> braucht — auf Papier wirkt es leicht unscharf.

Both halves are wrong. The photograph on file is usually 4032 × 3024, which is
about 660 dpi on a 154 × 111 mm card — nothing to warn about. And 300 dpi is
the ideal for something held at 25 cm and studied; a postcard is read at arm's
length, and every commercial postcard printer takes 200 dpi and up. The message
is a yellow panel, which is the treatment this product uses for things that
stop a send, and it appears on a page where somebody is about to spend twenty
credits.

Two smaller things on the same page, from the same look:

- **The printer-address note is three lines of explanation** where the question
  is one line long. It says the address and the postage mark are the post
  office's own and are left off the card we send. What the owner needs to know
  is only that the address is printed by the post — the rest is a note to
  ourselves.
- **The step panels are centred while everything else is left-aligned.** On a
  desktop the heading, the step bar and the forward button sit at the left
  margin and the photograph sits in the middle of the page, so the button looks
  unrelated to the panel it belongs to. `mx-auto` on the panels is the whole
  cause.

## Work

**Print the original.** Reuse `printSourceFor` rather than writing a second
copy of it — same fallbacks, same reasons: no original kept, or an original
that is not a JPEG and so cannot be embedded. `orderPhotoFile` stays as the
traversal guard and the better copy is only looked for once it has passed.

**Say nothing about resolution unless it is genuinely bad.** A floor in
`spec.ts` — 180 dpi, which an A6 with bleed reaches at about 1091 × 787 — and
`resolutionNote().ok` means "nothing worth saying" rather than "hits the
ideal". Below it, one quiet line in the ordinary text colour that suggests
picking a different photograph, and no number: a dpi figure is a fact about
printing that a person cannot act on.

**Shorten the printer-address note** into the caption under the card.

**Left-align the step panels** with the heading, the bar and the buttons.

Not doing: downscaling the original before it is embedded. The photobook
already embeds originals whole and nothing has complained; if a provider ever
refuses a large PDF that is its own ticket, with a measurement in it.

## Acceptance

- A card made from a day whose original is on disk prints from that original,
  and the resolution line does not appear at all.
- A photograph with no original kept still prints, from the derivative.
- A genuinely small photograph (under 180 dpi on the card) gets one plain line
  suggesting another photograph, with no dpi figure and no yellow panel.
- At 1280px the photograph, the warning and "Looks right" all start at the same
  left edge as the heading.
