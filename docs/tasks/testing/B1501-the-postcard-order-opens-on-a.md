---
id: B1501
title: The postcard order opens on a card that stands between the owner and the first step
type: ISSUE
priority: high
complexity: low
area: postcards
found: "2026-09-11T18:30:46Z"
started: "2026-09-11T18:47:26Z"
merged: "2026-09-11T18:54:25Z"
---

# B1501 — The postcard order opens on a card that stands between the owner and the first step

## Why

B1490 put a card in front of the steps — the front, *Eine Karte wartet auf
dich*, and *Karten öffnen*. Drawn from the approved flow, and wrong in
practice: the owner has just tapped the photograph and knows exactly what is
waiting. The card is a press between them and the thing they came to do.

## Work

Land on the first step. The sentence the card carried — nothing has been
printed or charged — stays in the intro under the title, where it already is.

The opening machinery in `PostcardSteps` goes with it, and so do the three
strings B1490 added, in all three locales.

## Acceptance

Opening a pending order shows `1 Ansehen` and the photograph, with no card and
no extra press before them.