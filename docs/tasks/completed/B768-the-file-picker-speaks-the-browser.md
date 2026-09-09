---
id: B768
title: The file picker speaks the browser's language, not the journal's
type: ISSUE
priority: high
complexity: low
area: agent, ui, i18n
found: "2026-09-07T14:05:38Z"
started: "2026-09-07T14:06:07Z"
merged: "2026-09-07T14:29:47Z"
completed: "2026-09-09T16:46:33Z"
---

# B768 — The file picker speaks the browser's language, not the journal's

## Why

On the wizard's photograph step, a German journal shows a yellow button reading
**Choose files** and, beside it, **No file chosen**. Every other word on the
page is German.

It is not a missing translation. It is `<input type="file">`, whose button text
and "no file chosen" label are drawn by the browser in the *browser's* locale
and cannot be set from CSS or from a `value`. A styled file input is styled
around that text, never over it. So a German-speaking person on an
English-configured phone — which is most phones handed down or bought abroad —
reads two English words at the exact moment they are being asked to hand over
their photographs.

Seen on the live instance on 2026-09-07.

## Work

The standard remedy, and it is small: keep the real `<input type="file">` but
hide it visually (not `display: none`, which takes it out of the accessibility
tree — the usual clipped-rect technique), and put a `<label>` styled as the
button in front of it. The label's text is ours, translated, and clicking it
still opens the picker because that is what a label does.

Replace "No file chosen" with our own count, in the journal's language: *Keine
Fotos gewählt* / *12 Fotos gewählt*. That string is more useful than the
browser's anyway — the browser names one file and says nothing about twelve.

Check every other `type="file"` in the codebase while there; the same input
appears wherever media is picked.

## Acceptance

A German journal on an English browser shows only German on the photograph
step, keyboard focus still reaches the control, and the picker still opens.
