---
id: B1724
title: The demo journal asks readers to subscribe to notifications from a journal that is not theirs
type: ISSUE
priority: medium
complexity: low
area: journal pages
found: "2026-09-14T12:30:00Z"
started: "2026-09-14T10:29:10Z"
session: 68f03fd3-84f8-42b3-b482-61bfc4440340
claimed: "2026-09-14T10:29:10Z"
---

# B1724 — The demo journal asks readers to subscribe to notifications from a journal that is not theirs

## Why

A reader who spends fifteen seconds on `/example` gets "Get the next day? We
can let you know on this device when a new day is published here." That ask
is right on a journal somebody follows — B440 wrote it for the person reading
their daughter's trip — and wrong on a demonstration. The reader is not
following Alex Berger's pickup-and-tent trip across the western United
States; they are deciding whether to make a journal of their own. Push
notifications from the demo are not what they came for, and agreeing is a
browser-level permission they cannot easily undo.

It also competes. B1718 put the showcase bar at the foot of the same page for
the same reader at the same moment, and the two now stack — the prompt sits
directly on top of the bar, which is the arrangement `--fs-showcase-bar`
exists to keep legible. Two things asking at once is one too many, and the
bar is the one that answers the question this reader actually has.

## Work

Do not render `PushPrompt` on a journal named in `site.showcase`. The layout
already resolves that list for `ShowcaseBar`, so this is the same condition
read once and spent twice: showcase journals get the bar, every other journal
gets the prompt exactly as before.

The `--fs-showcase-bar` offset on `PushPrompt` becomes dead once the two can
no longer appear together — remove it with the change rather than leaving a
rule that looks like it is doing something. `body`'s padding from the same
variable stays: that is what keeps the bar off the last line of a day.

## Acceptance

- `/example` shows no notification prompt, however long a reader stays.
- A journal not in `site.showcase` still shows it on exactly the same terms
  as before — dwell time, scroll, snooze and never all unchanged.
- `PushPrompt` no longer reads `--fs-showcase-bar`, and `body` still does.
- `npm run verify` passes.
