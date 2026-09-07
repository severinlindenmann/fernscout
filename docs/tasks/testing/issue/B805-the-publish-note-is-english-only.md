---
id: B805
title: The publish note is English only and is shown to people
type: ISSUE
priority: medium
complexity: low
area: api, i18n
found: "2026-09-07T15:16:03Z"
started: "2026-09-07T16:22:33Z"
merged: "2026-09-07T16:55:22Z"
---

# B805 — The publish note is English only and is shown to people

## Why

The publish note B775 rewrote is good — the same 71-year-old called it the best
sentence in the test and understood exactly what it meant. It is also
**English**, and it is shown to people.

`publishNotice()` in `lib/api/entries.ts` builds one English string. It was
written for an agent to relay, and B775 added a line to `/agent.md` telling the
agent to read it out rather than paraphrase — which is right, and which also
means it reaches a German reader verbatim, including the untranslated
vocabulary word:

> "The trip is **guest**, so it can be read by you and the people you have
> approved into this journal…"

She read "guest" and asked: a guest of what — of the diary, or of the trip?
That is exactly the distinction AGENTS.md says people get wrong, met in an
untranslated English word inside an otherwise German flow.

## Work

Give the note the journal's locale, the way the rest of the site is written,
and translate the visibility vocabulary rather than passing the raw value
through. The wizard already knows the locale; the API route knows the journal.

Check the other notes an agent is told to relay for the same problem — a
sentence written for a machine that a person ends up reading.

## Acceptance

A German journal's publish note is German, including the word for who can read
the trip.
