---
id: B924
title: A note written for the model is printed to the person
type: ISSUE
priority: high
complexity: low
area: agent, ui
found: "2026-09-08T07:12:20Z"
started: "2026-09-08T07:26:33Z"
merged: "2026-09-08T07:52:11Z"
completed: "2026-09-09T16:47:30Z"
---

# B924 — A note written for the model is printed to the person

## Why

A designer testing the room saw a proposal render as literal text:

```
[proposed, not written, waiting to be pressed: draft_words {...}]
```

with no card and no button.

That string is the `remembered` marker B900 added to the thread so the model can
*correct* its own proposal on the next turn — it is written for the model and it
is being printed to the person. Sometimes; `unpublish_day` did it too, and the
same tool rendered properly on other turns.

The effect is worse than ugly: the person is shown something that says a
proposal is waiting to be pressed, and there is nothing to press. It is B920's
failure by another route — the software describing an action that is not
available.

Found live on 2026-09-08.

## Work

Keep the marker out of what is rendered. The thread carries two audiences and
they need separating explicitly: what the model is told about the last turn, and
what the person is shown.

Then work out why it is intermittent — a turn that produces a proposal *and*
prose may be putting both through the same path. That is the actual defect;
the string leaking is the symptom.

## Acceptance

Nothing written for the model is ever rendered, and a proposal always arrives
as a card with a button.
