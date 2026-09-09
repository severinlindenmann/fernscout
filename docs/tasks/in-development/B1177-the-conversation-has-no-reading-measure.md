---
id: B1177
title: The conversation has no reading measure on a wide screen
type: ISSUE
priority: medium
complexity: low
area: helper room
found: "2026-09-09T20:30:37Z"
started: "2026-09-09T20:31:00Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T20:31:00Z"
---

# B1177 — The conversation has no reading measure on a wide screen

## Why

At 1440px the conversation column is ~1000px wide and every line of text
spans it — a reading measure over 150 characters, far past the ~65ch a
paragraph stays readable at. Every chat product caps the thread's measure;
the room does not (`HelperAsk`'s log and `RoomOpening`'s cards fill
`main`'s full flex width).

## Work

A max-width (~46rem) centered wrapper for the conversation log, the
opening and the composer inside the room's `main`. The column itself keeps
its flex width — only the content is capped, so the layout math (rails,
preview) is untouched.

## Acceptance

At 1440px with both rails collapsed, a turn's text wraps at roughly
65-75 characters; at 390px nothing changes.
