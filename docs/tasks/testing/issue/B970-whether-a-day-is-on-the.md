---
id: B970
title: Whether a day is on the site is answered from the person's own sentence
type: ISSUE
priority: medium
complexity: low
area: helper, honesty
found: "2026-09-08T13:31:20Z"
started: "2026-09-08T13:46:06Z"
merged: "2026-09-08T13:50:02Z"
---

# B970 — Whether a day is on the site is answered from the person's own sentence

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

> "I pressed it, is June 13th live now?"
> "Yes, June 13th is live on the site now."

`looked: []` — no read, no check. It was true, because they had just pressed
publish, and it was true by luck: the answer was an inference from the
person's own sentence rather than a fact about the site.

B932 settled this shape for what a day *says* — a turn claiming that without
having called `read_day` is caught and asked again. Whether a day is **on the
site** is the same kind of claim and has no such check, and it is the one a
person asks when they are anxious: they ask precisely because they are not
sure, and the answer is the whole of what they get.

Since B939 the conversation has a `written:` note when a press really
happened, so the honest version of this answer is available — but a note that
`publish_day` was pressed is not the same as the day being up, and reading the
day is.

## Work

A sixth territory in the net: a turn that states whether a day is published,
without having read that day, is asked again. `read_day` already returns
`draft`, so the model has the fact as soon as it looks.

The matcher is the work — "is up", "is live", "on the site", "steht auf der
Seite", "fenn van" — and B967 is the standing warning about writing those in a
language without a sentence beside them.

## Acceptance

"Is it up?" answered with yes and no `read_day` call is caught. The same answer
after a real read is not.
