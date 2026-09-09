---
id: B1021
title: The one-bright-thing rule cites a test that was never written, and is false where it matters
type: ISSUE
priority: high
complexity: low
area: helper, ui
found: "2026-09-08T19:34:58Z"
merged: "2026-09-08T19:55:56Z"
completed: "2026-09-09T16:47:19Z"
---

# B1021 — The one-bright-thing rule cites a test that was never written, and is false where it matters

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`components/RoomOpening.tsx` says, in its own doc comment:

> Whichever state is drawn below there is one `bg-yellow-400`, and
> `test/room-opening.test.tsx` is where that is now enforced.

**That file does not exist.** It was written by the same session that wrote the
component, describing a test it did not write — a false claim in a comment,
which is the exact fault this product spent a day building guards against, made
in the guard's own documentation.

And the rule itself is false in the commonest state. Whenever the preview
renders a day — which it does by default in `days`, and for any `?about=` link
— `components/StoryPager.tsx` draws a page-position dot with `bg-yellow-400`.
Counted on the live page: **2 in `days`, 1 in `clear` and `finished`.**

The dot is `aria-hidden` and not interactive, so nothing is *broken* for
somebody using the page. What is broken is the claim, and the claim is what the
whole redesign was measured by.

## Work

Write the test, and let it decide what the rule actually is. Two honest
readings:

- **Bright things that can be pressed.** The dot is decoration and does not
  compete for attention the way a button does; the rule becomes one yellow
  *control*, and the test counts those.
- **Bright things at all.** Then the dot needs a different colour, and B767's
  "one bright thing" is literal.

The first is more defensible and the second is easier to check. Either way the
comment stops describing a file that is not there.

Not doing: deleting the sentence and moving on. The rule is right; it is the
enforcement that was imagined.

## Acceptance

`test/room-opening.test.tsx` exists, renders every state, and fails if the rule
it states is broken. The comment describes what the test does.
