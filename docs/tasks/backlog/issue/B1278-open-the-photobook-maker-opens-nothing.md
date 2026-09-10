---
id: B1278
title: Open the photobook maker opens nothing and prints a bare URL that is not a link
type: ISSUE
priority: medium
complexity: low
area: helper, photobook
found: "2026-09-10T10:26:45Z"
---

# B1278 — Open the photobook maker opens nothing and prints a bare URL that is not a link
## Why

Asked for a photobook, the helper offers a card with a size, a cover and a dark
primary button: **Open the photobook maker**.

Pressing it does not open the photobook maker. It prints, into the chat, the
line

```
https://fernscout.ch/test-mobile/trips/bern-weekend-2026/photobook
```

followed by *"A link to their photobook page is waiting…"* (the third person is
B1277). The URL is **plain text** — `document.querySelectorAll("a")` matching
`/photobook/` returns nothing — so on a phone it cannot be tapped. Getting to
the maker means selecting a long URL out of a chat bubble by hand, or retyping
it.

The card's own copy is honest about the mechanism — *"This hands over the page
where the pages are laid out, priced and paid for"* — which makes the button
label the odd part: it promises to open, and it does not, in the same way
B1275's publish button promises to publish and does not.

Everything else about the card is good: four sizes, two covers, and no charge
until the maker.

## Work

- Either navigate on press, or make the thing it produces a real link the person
  can tap.
- A bare URL printed into a conversation is not an interface at any width; if the
  room can only hand over a link, it should hand over a labelled one.
- Check whether any other tool answers with a raw URL — the postcards flow says
  something similar and may have the same shape.

## Acceptance

- Pressing the photobook card's button lands on the photobook page, or produces a
  tappable link with a readable label.
- No raw URL is rendered as plain text in the room.
