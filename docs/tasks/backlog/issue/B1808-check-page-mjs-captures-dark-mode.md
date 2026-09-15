---
id: B1808
title: check-page.mjs captures dark mode when asked for light, so every light-theme screenshot this repository has taken may be dark
type: ISSUE
priority: high
complexity: low
area: testing, browser capture
found: "2026-09-15T19:34:12Z"
---

# B1808 — check-page.mjs captures dark mode when asked for light, so every light-theme screenshot this repository has taken may be dark

## Why

Headless Chrome's own default for `prefers-color-scheme` is **dark**. Nothing in
`.claude/skills/test-in-a-browser/check-page.mjs` emulates the media feature, so
a capture taken without a theme cookie renders in dark whatever the agent
believed it was looking at. Found while capturing B1803 Phase 2: an agent
captured what it labelled "light", compared it against a deliberate dark run,
and the two were the same picture. It only surfaced because the two were placed
side by side — it would have passed unnoticed in any run that captured one
theme.

This is worse than a missing capability, because the file on disk is what
`work-on-a-task` treats as evidence. Every "verified at desktop and phone width"
in this repository that did not set a theme cookie may have verified one theme
twice, and the reviews that read those captures inherited the same error. B1798
(green and coral failing the contrast floor in dark mode across thirty-five
components) is the kind of defect that survives exactly this blind spot, and it
was found by a person, not by a capture.

Sibling of [[B1804]], which is the same script's other blind spot: it cannot
click, so only resting states are ever photographed.

## Work

Emulate the media feature explicitly rather than inheriting the browser's
default — `page.emulateMediaFeatures([{ name: "prefers-color-scheme", value }])`
— and make the theme part of the capture's identity rather than an assumption:

- a `--theme light|dark|both` flag, defaulting to **both**, since a single-theme
  capture is what made this invisible;
- the resolved theme in the output filename and in the JSON, so a reader can
  tell what they are looking at without trusting the agent's label;
- the JSON records the value actually emulated, not the value requested.

Check whether the site's own theme cookie and the media feature can disagree —
if the cookie wins, say so in the skill, because then the flag is a fallback
rather than the control.

## Acceptance

- A capture asked for light is light, proven by two runs of the same URL at
  `--theme light` and `--theme dark` producing visibly different images.
- The theme appears in the filename and in the JSON.
- `.claude/skills/test-in-a-browser/SKILL.md` says the default was dark and why
  a single-theme capture is not evidence.
