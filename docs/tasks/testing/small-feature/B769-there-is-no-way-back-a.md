---
id: B769
title: There is no way back a step in the wizard
type: FEATURE
priority: high
complexity: low
area: agent, ui
found: "2026-09-07T14:05:40Z"
started: "2026-09-07T14:06:07Z"
merged: "2026-09-07T14:29:48Z"
---

# B769 — There is no way back a step in the wizard

## Why

The wizard is six steps and has no way back. A person who picks the wrong trip
on step one, or who wants to add a photograph after moving on to the words, has
one option: leave the page and come back, which resumes the draft at whatever
step its own state implies. That is a recovery, not a control.

The state model makes going back cheap — `stepFor()` derives the step from the
draft on disk, so "back" is a matter of showing an earlier step rather than
unwinding anything. Nothing needs undoing; the day already exists.

This matters more here than in most wizards because the audience is somebody
who is not sure they pressed the right thing, and the absence of a back button
is what turns a small mistake into abandoning the page.

## Work

A quiet back control on every step after the first, one that names where it
goes — *Zurück zu den Fotos* rather than a bare arrow — because a person who is
lost is not helped by an arrow.

On the first step it is absent rather than disabled. On the last step, after
the day is published, it is absent too: that screen is an ending.

Consider what "back" means once photographs are uploading (B683) — the queue
keeps running, so the answer is that it simply keeps running, and the progress
line already follows the person.

## Acceptance

From any step but the first, one tap goes back a step and the draft is
unchanged. Checked at 390px.
