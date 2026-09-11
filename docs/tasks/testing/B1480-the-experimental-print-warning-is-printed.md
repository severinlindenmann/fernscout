---
id: B1480
title: The experimental-print warning is printed twice on the same screen
type: ISSUE
priority: high
complexity: low
area: photobook
found: "2026-09-11T15:56:55Z"
started: "2026-09-11T15:58:19Z"
merged: "2026-09-11T16:03:31Z"
---

# B1480 — The experimental-print warning is printed twice on the same screen

## Why

`ExperimentalPrintNotice` renders twice on one screen of the photobook
composer: once under the trip title at the top of the page, and again inside
the order panel directly above the press. Same forty words, same coral, two
hundred pixels of scroll apart. Seen at 390 and at 1280 on the live instance,
2026-09-11.

Coral is this palette's failure colour and it is spent twice here on a notice
that is not a failure. A warning repeated verbatim is a warning somebody
learns to scroll past, which is the opposite of what B1368 put it there for —
it is meant to be the last thing read before the button.

## Work

One notice, immediately above the press, which is what B1368 asked for. Find
both call sites (`PhotobookPageContent.tsx` and `BookLevelView.tsx` are the
likely pair) and decide which is the button's; delete the other.

Check the day-level view as well before deleting — if the page-level one is
the only notice a reader of the day view ever sees, it moves rather than goes.

## Acceptance

One occurrence of the notice in `document.body.innerText` on the composer at
both widths, immediately above the order button.