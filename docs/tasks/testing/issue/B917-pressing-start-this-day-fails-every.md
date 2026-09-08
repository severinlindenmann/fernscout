---
id: B917
title: Pressing start this day fails every time
type: ISSUE
priority: high
complexity: low
area: agent
found: "2026-09-08T07:07:04Z"
started: "2026-09-08T07:07:46Z"
merged: "2026-09-08T07:26:26Z"
---

# B917 — Pressing start this day fails every time

## Why

The `start_day` proposal the model produces carries `{trip, date}` and nothing
else. `POST /api/helper/<user>/day` with only those fields answers:

```
422 {"error":"incomplete_day","missing":["costs","coordinates"]}
```

A trip tracks costs, coordinates and photographs (`lib/tracks.ts`), and a day
cannot be written until each is answered — with a figure, with `false`, or with
`"unknown"`. The wizard asks those questions on its own screen. **The
conversation never asks them and never sends them, so pressing "Start this day"
fails every time.**

The main path of the new surface does not work.

It was invisible until now because B916 hides it: the card says the day was
started, so nothing looks wrong until somebody goes looking for the day.

A blind tester hit it, could not get past it from the conversation, and only
completed a day by discovering `answers: {costs:"none", coordinates:"none"}`
through the API — vocabulary the proposal never shows.

Found live on 2026-09-08.

## Work

The trip's questions have to reach the person, in the conversation, before the
day is written. Two honest shapes:

- **A `choose` block** per question, in the words `lib/tracks.ts` already uses —
  "there was none" and "nobody wrote it down" — which is what the wizard shows
  and what B560 built the third answer for.
- Or `start_day` carries the answers as fields on its own proposal, defaulted
  to `unknown` with a line saying so, which is what B810 decided for the express
  path: *nothing is invented — it has only not been asked yet*.

The second is fewer turns and matches the decision already made for the wizard.
Either way the person must be able to say a real figure instead.

Fix B916 first or alongside; without it, this failure is invisible again the
moment it recurs.

## Acceptance

A day can be started from the conversation, by pressing the proposal the
conversation offered, with no other call.
