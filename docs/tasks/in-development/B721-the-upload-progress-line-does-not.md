---
id: B721
title: The upload progress line does not say which day it belongs to
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T11:44:11Z"
started: "2026-09-07T12:55:02Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:55:02Z"
---

# B721 — The upload progress line does not say which day it belongs to

## Why

The upload progress line in `components/AgentWizard.tsx` follows the person
through the wizard, which is right — the originals keep climbing while they
write. But a queue row is keyed to the day it was picked for, so somebody who
picks photographs, walks on, and then opens a *different* unfinished draft
still sees the first day's originals counting up, with nothing on screen saying
which day they belong to.

Correct behaviour, unclear label.

## Acceptance

The progress line names the day it is about whenever that is not the day on
screen.
