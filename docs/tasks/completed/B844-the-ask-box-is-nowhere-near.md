---
id: B844
title: The ask box is nowhere near the pages an owner actually uses
type: FEATURE
priority: high
complexity: low
area: agent, ui
found: "2026-09-07T16:43:29Z"
started: "2026-09-07T17:03:01Z"
merged: "2026-09-07T17:23:38Z"
completed: "2026-09-09T16:45:03Z"
---

# B844 — The ask box is nowhere near the pages an owner actually uses

## Why

A 47-year-old retesting on 2026-09-07 did all six of her tasks from the
journal's own pages — the day, the trip, the story — and reported:

> "There's no request box. 'Search' is a plain fuzzy day-finder, and it treats
> every sentence the same way."

She typed "fix a typo in tuesday" into it and got six day cards. "What did the
trip cost" returned the same list again.

She is right, and the ask box is not broken: it lives on `/agent`, and she was
never there. An owner who has published a journal spends her time on the
journal, and the one control built to take a sentence and do something with it
is on a page she has no reason to open.

Worse, the page she *was* on has a box that looks exactly like the thing she
wanted — a text field that accepts a sentence and answers with a list. Search
is not at fault; adjacency is.

This is the ask box's whole return on investment: B685 built the router, B817
made it refuse safely, B783 gave it a real read row — and the person it was for
never sees it.

## Work

Put the ask box where an owner is: the journal home, the trip page, the day
page — behind the same owner check the "Correct or take down this day" link
uses, so a reader never sees it.

Do not merge it with Search. They answer different questions, and the honest
distinction is what stops "fix a typo in tuesday" returning six cards. If they
end up adjacent, say which is which in one word each.

## Acceptance

From the day she just published, an owner can type "fix a typo in tuesday" into
something that opens the day for correcting.
