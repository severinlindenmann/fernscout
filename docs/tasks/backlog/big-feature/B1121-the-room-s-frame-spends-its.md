---
id: B1121
title: The room's frame spends its top bar on two sentences and has no history, no new conversation and a cramped preview
type: FEATURE
priority: high
complexity: high
area: components/HelperRoom.tsx
found: "2026-09-09T17:45:57Z"
---

# B1121 — The room's frame spends its top bar on two sentences and has no history, no new conversation and a cramped preview

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The top bar carries two long German sentences as buttons —
"Dateien einblenden", "Vorschau ausblenden" — and nothing else. Everything
reached for repeatedly is missing or misplaced:

- no history, and no way to start a fresh conversation;
- returning to `/agent` gives a blank room rather than where you were;
- the preview, which is the actual product being made, is the narrowest column
  on the screen;
- "Zurück" sits below the fold, under the composer.

On a phone none of it works at all: three columns cannot become one screen by
getting narrower.

## Work

**Desktop.** Toggles become icons on the edge of the panel they open — a files
rail that collapses to about 40px and keeps a count. Top right takes two icons:
a clock for history and one accent button for a new conversation. The preview
grows to 380–440px with a drag handle. Back becomes a chevron before the
journal name, and the name becomes the journal switcher.

**Phone (390px).** Nothing lives beside the conversation. The preview is a
bottom sheet that rises to a ~112px peek by itself when the subject changes and
drags to about 78%. Files are not a column at all — see B1123.

**Rejected, and worth recording:** three swipeable pages mirroring the desktop
columns. Horizontal swipe collides with text selection, with scrolling a wide
card, and with the browser's own back gesture at the screen edge. A vertical
sheet collides with nothing and can peek, which a page cannot.

Also fold in **B1102** — signing in still redirects to `/agent/<journal>`, the
old wizard — since it is the same file and the same argument.

Not doing: the history panel's contents (B1109 owns that) or the files pane
(B1123).

## Acceptance

At 1440px the preview is the second-widest column and can be dragged. At 390px
the conversation is the whole screen and the preview peeks when the subject
changes. Signing in at `/agent` lands in the room, and the address bar still
reads `/agent`.
