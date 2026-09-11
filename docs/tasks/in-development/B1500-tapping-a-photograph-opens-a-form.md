---
id: B1500
title: Tapping a photograph opens a form asking what the flow is about to ask again
type: FEATURE
priority: high
complexity: medium
area: postcards
found: "2026-09-11T18:30:45Z"
started: "2026-09-11T19:01:39Z"
session: 3f748903-2dc3-47a2-a958-98b83d641dc0
claimed: "2026-09-11T19:01:39Z"
---

# B1500 — Tapping a photograph opens a form asking what the flow is about to ask again

## Why

From the gallery, pressing *Postkarte senden* and tapping a photograph opens a
dialog that asks four things: which day the words come from, which language,
who gets one, and then *Vorschau erstellen*. Every one of those is asked again,
better, in the flow the dialog leads to — the words on the Write step, the
language beside them, the recipients on Send.

So it is a form in front of a form, and it is the one screen in the flow that
looks like a settings dialog rather than like the product.

## Work

Tapping a photograph creates the proposal and goes straight to it. The
defaults the dialog was collecting are the ones it already offered: the day the
photograph belongs to for the words, the journal\x27s own locale, and nobody
chosen yet — the Send step is where recipients are picked and it already
refuses to send with none.

Not doing: removing the ability to write from a different day. That is the
Write step\x27s business and it is already there.

## Acceptance

Gallery → *Postkarte senden* → tap a photograph lands on the order\x27s own first
step with no dialog in between, and the words are the day\x27s.