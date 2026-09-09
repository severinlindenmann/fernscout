---
id: B940
title: A trip the journal does not have is silently answered with the one it does
type: ISSUE
priority: high
complexity: low
area: helper, model
found: "2026-09-08T09:49:14Z"
started: "2026-09-08T09:51:24Z"
merged: "2026-09-08T09:59:54Z"
completed: "2026-09-09T16:47:26Z"
---

# B940 — A trip the journal does not have is silently answered with the one it does

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`resolveTrip()` in `lib/helper/tools.ts:174` ends every lookup with `?? trips[0]`.
That fallback is right for an *omitted* trip — a person mid-write-up means the
newest one — and wrong for a *named* one that matches nothing.

A tester asked for "a day in my Antarctica Expedition trip" in a journal whose
only trip was `tokyo-sprint-2026`. Nothing said the journal has no such trip.
The conversation asked which date, and then proposed a day **in Tokyo**, with no
disclosure. Nothing was written — the proposal was not pressed — but it was
filled in and ready, and an impatient person who does not read the card would
have put an invented Antarctic day into a real trip.

Four steps of matching run before the fallback (exact id, flattened id, title,
prefix, substring), so a model that shortens `georgia-2026` to `georgia` — the
case B927 added the fallback for — is already caught by the prefix step. What
is left for `?? trips[0]` to catch is a name that genuinely resolves to nothing,
which is exactly the case that must not resolve.

The same `?? args.trip` substitution runs in `start_day` (:576) and
`tripIdFor()` (:249), so a name nobody has ever used reaches a proposal's
`trip` field as though it were an id.

## Work

- Drop the fallback when a name was given and matched nothing. Keep it for an
  omitted name, which is what B927 is actually about.
- Stop `start_day` and `tripIdFor` substituting the person's words for an id.
  An empty `trip` already reaches the "nothing was proposed" path in
  `runTool` (:1131), which tells the model to ask which trip they mean.
- The read tools answer `why: "there are no trips in this journal"` when the
  trip does not resolve. That sentence becomes a lie the moment a name misses
  in a journal that has trips. Say which of the two it is.

Not doing: naming the nearest trip as a suggestion. Asking is enough.

## Acceptance

A test that puts one trip in a journal, names a different one, and fails if a
proposal comes back at all — and a second that keeps the omitted-name fallback
working, so B927 does not regress.
