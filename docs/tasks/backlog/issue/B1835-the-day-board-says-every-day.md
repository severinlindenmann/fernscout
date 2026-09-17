---
id: B1835
title: The day board says every day is told while the undated card still has unanswered questions
type: ISSUE
priority: medium
complexity: low
area: extract, day board
found: "2026-09-17T05:27:05Z"
---

# B1835 — The day board says every day is told while the undated card still has unanswered questions

## Why

Seen in a browser walk for B1834, on a run whose two photographs carried no
EXIF date: the day board showed the undated card with **three unanswered
questions**, and directly beneath it the line *"Every day is told."*

`nextDayToTell` (`components/extract/DayBoard.tsx`) deliberately excludes the
undated group — it has no weekday, so it can never be "Tell me about Friday",
and that exclusion is right. But the *fallback* sentence for "no next day" then
claims all the work is done, which is false whenever the only work left is the
undated card. A person reading it would reasonably press "Done for now" and
leave three questions unanswered, and those photographs then never get a date,
so they can never be committed.

The B1803 ruling that the undated group is not a day was about COUNTS — so that
"See my 9 days" and the board's own "of 9" agree. It was never a claim that the
undated card is not work.

## Work

Separate the two states the fallback currently merges: every real day told AND
nothing else outstanding, versus every real day told BUT the undated card still
has open questions. The second needs its own sentence pointing at the undated
card — it is the only thing left to do, and it is the one the person is about
to walk away from.

Check the same question for "Done for now"'s own reassurance text.

## Acceptance

- A run whose only outstanding work is the undated card does not say every day
  is told.
- A run with genuinely nothing outstanding still does.
- A test covers the undated-only case.
