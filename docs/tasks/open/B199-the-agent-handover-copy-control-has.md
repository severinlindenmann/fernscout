---
id: B199
title: The agent-handover copy control has two values and a newline in one accessible name
type: ISSUE
priority: low
complexity: low
area: a11y, ui
found: "2026-09-03"
---

# B199 — One accessible name carrying two things

## Why

Noticed while verifying B79 on the live site, in the neighbouring block rather
than in B79's own. The `CopyLine` in the agent-handover section of
`/<user>/me` carries:

```
aria-label="Copy link: https://fernscout.ch/documentation.txt\nxydhd-qa1@severin.io"
```

Two separate values — the documentation URL and the owner's address — joined by
an embedded newline, inside a single accessible name.

Visually this block is right, and B75 verified the sighted version: two lines,
clearly the pair of things an owner hands to an agent. The accessible name is
where the pairing falls apart. A screen reader announces one run of text with
no boundary between the two, so a URL and an email address arrive as one
string, and "Copy link" describes a control that copies both. Newlines in an
accessible name are not reliably announced as a break — the behaviour varies by
reader — so the listener gets no cue that there were ever two values.

The stakes are small and specific: this is the one control on the page whose
whole purpose is to hand two exact strings to somebody else, and it is the
first thing the owner of a new journal is pointed at. Getting one string where
there were two is a real way to be confused about what was copied.

## Work

- Give the control an accessible name that describes what it copies rather than
  reciting it — "Copy the two lines to hand an agent" or similar — and let the
  values be read from the visible text, which is already correctly marked up.
- If the values should be in the name, make it one value per control: two
  `CopyLine`s, each naming what it holds.
- Check the other `CopyLine` uses while in there. B79's invite panel uses the
  same component with a single value and is fine, but that is the only other
  caller and it is worth confirming it stays that way.

Not doing: changing the visible layout. B75 verified it and it reads well.

## Acceptance

- No accessible name on the page contains an embedded newline.
- The handover control's name says what it copies; the values are reachable as
  page text.
- The invite panel's copy control is unaffected.
