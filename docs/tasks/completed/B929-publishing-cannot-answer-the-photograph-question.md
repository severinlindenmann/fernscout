---
id: B929
title: Publishing cannot answer the photograph question and fails every time
type: ISSUE
priority: high
complexity: low
area: agent
found: "2026-09-08T08:05:57Z"
started: "2026-09-08T08:05:58Z"
merged: "2026-09-08T08:25:26Z"
completed: "2026-09-09T16:46:02Z"
---

# B929 — Publishing cannot answer the photograph question and fails every time

## Why

She could not publish, after twenty-three messages.

Publishing needs the trip's **photographs** question answered — `photos` is a
`when: "publish"` row in `lib/tracks.ts` — and `publish_day` cannot answer it.
The press fails `incomplete_day`, five times.

B917 fixed exactly this for `start_day`, and **deliberately excluded `photos`**
on the reasoning that it is "a publish-time row with nothing to answer about
yet". That was right for creating a day and leaves the hole at the other end:
at publish there *is* something to answer, and nothing asks.

Worse, the helper claimed it had answered:

> "Der Tag ist bereit zur Veröffentlichung – ohne Fotos"

The API's `unrecorded` never gained a photos entry and the next press failed
identically. That half is B928; this ticket is the missing question.

Her own fix, and it is the right one: *"a form would have just asked photos
yes/no/unknown as a checkbox at the point of publishing."*

## Work

Give `publish_day`'s confirm the publish-time questions the trip keeps, exactly
as B917 gave `start_day` the write-time ones: native selects in
`lib/tracks.ts`' own vocabulary, opening on "nobody has said", with the same
line explaining that nothing is invented.

Keep B917's discipline: the questions stay **off the model's `properties`** so
it cannot answer them on somebody's behalf. Only the person's own select does.

Then check every other write tool for a track it cannot answer, so the third
instance of this is caught by a test rather than by a tester.

## Acceptance

A day can be published from the conversation, by pressing the proposal the
conversation offered, with no other call.
