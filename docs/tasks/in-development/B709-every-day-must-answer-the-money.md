---
id: B709
title: Every day must answer the money question before it is written
type: ISSUE
priority: low
complexity: medium
area: entries, tracks
found: "2026-09-07T11:17:11Z"
started: "2026-09-07T11:40:35Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:35Z"
---

# B709 — Every day must answer the money question before it is written

## Why

`lib/tracks.ts:126` — `TRACK_ROWS.costs.when` is `"write"`, so a trip that
tracks costs demands an answer about money at the moment a day is created. The
wizard (B682) meets this on its first screen, before the person has chosen a
photograph, and an agent meets it before it has been told anything about the
day.

The honest answer at that moment is almost always "nobody has it yet", and a
question asked too early is answered wrongly and rarely revisited — which
quietly fills the journal with `costs: unknown` on days that did have costs.

Whether costs belong at write or at publish is a product decision, not a bug,
which is why this is a ticket and not a fix. B554 is adjacent but is about the
third answer rather than about when the question is asked.

Found while building B682, and seen again in the browser: the first screen of
the wizard asks about money before it asks about anything else.

## Work

Decide whether `costs` moves to `when: "publish"`. If it does, check every
writer that currently satisfies it at write time. If it does not, write down in
`lib/tracks.ts` why, so the next person does not re-open it.

## Acceptance

Either the question is asked at publish, or the file says why it is asked at
write.
