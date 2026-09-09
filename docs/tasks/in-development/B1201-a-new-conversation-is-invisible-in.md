---
id: B1201
title: A new conversation is invisible in the history panel, so nothing says where you are
type: ISSUE
priority: medium
complexity: low
area: helper room
found: "2026-09-09T22:54:56Z"
started: "2026-09-09T22:55:27Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T22:55:27Z"
---

# B1201 — A new conversation is invisible in the history panel, so nothing says where you are

## Why

Margrit retest: after "Neue Unterhaltung", the history panel listed her
three finished conversations and nothing marked where she now was — the
live conversation had no recorded turns yet, so it has no row, and the
B1168 "Current" badge had nothing to attach to. For a literal,
first-generation reader that is exactly the ambiguity that causes
hesitation: "which one am I in right now?"

## Work

When the live session is not among the listed rows, the panel pins one row
at the top for it — "This conversation", the Current badge, linking to
/agent — in en/de/hu.

## Acceptance

Open the panel right after +: the top row says where you are; open it from
an ongoing recorded conversation: the badge sits on that row exactly as
before.
