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

## What was built

**Valid** — the layout rendered `PushPrompt` unconditionally and `ShowcaseBar`
beside it, and both were seen on the live `/example` at once.

- The layout now picks one: a journal in `site.showcase` gets the bar, every
  other journal gets the prompt on exactly the terms it always had.
- `PushPrompt`'s `--fs-showcase-bar` offset is gone. With the two unable to
  share a page there is nothing left to lift, and a rule that can never apply
  reads as if it were doing something. `body`'s padding from the same variable
  stays — that is what keeps the bar off the last line of a day.
- `test/showcase.test.ts` asserts the layout branches on the list and carries
  exactly one of each component, and that the dead offset has not come back.

**One acceptance line is not captured, and here is why.** "A journal not in
`site.showcase` still shows the prompt" could not be driven locally: the
prompt also requires a registered service worker, and the dev server does not
register one, so the card never appears on `localhost` however the flags are
set — with `push` on, throwaway VAPID keys and `Notification.permission`
reading `default`, it still returned nothing. What is proven is that the
component's own conditions are untouched by this branch and that the layout
reaches it for every non-showcase journal. Worth an eye on a real journal
after the deploy.

## Acceptance

- `/example` shows no notification prompt, however long a reader stays.
- A journal not in `site.showcase` still shows it on exactly the same terms
  as before — dwell time, scroll, snooze and never all unchanged.
- `PushPrompt` no longer reads `--fs-showcase-bar`, and `body` still does.
- `npm run verify` passes.
