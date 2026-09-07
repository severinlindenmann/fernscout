---
id: B690
title: POST /api/v1/<user>/import: dryRun flag on costs import has no effect and response does not say so
type: ISSUE
priority: medium
complexity: low
area: API
found: "2026-09-07T09:54:25Z"
started: "2026-09-07T09:59:27Z"
merged: "2026-09-07T10:07:45Z"
completed: "2026-09-07T13:13:50Z"
---

# B690 — POST /api/v1/<user>/import: dryRun flag on costs import has no effect and response does not say so

## Why

The API accepts a `dryRun: true` flag on costs imports, but costs imports never write anything to disk anyway — a statement is analyzed and reported, and what each line was for remains an editorial decision left to the owner. Since the costs import is read-only by design, the `dryRun` flag is meaningless. A caller sending it gets no indication of that. They see a `200` response and reasonably conclude their import was a no-op when it was a full read of all transactions.

This violates the contract principle: a field the API accepts must appear in the response, or an agent cannot verify its own work.

## Work

Either remove the `dryRun` parameter from the costs import schema (since it has no effect), or document in the response why the flag is accepted and ignored. Clarify that costs imports are read-only and do not write regardless of `dryRun`.

Do not add a `dryRun` implementation for costs — that would be inventing a decision (what categories each transaction belonged to) that belongs to the owner.

## Acceptance

The `/openapi.json` schema for `POST /api/v1/<user>/import` (costs variant) no longer names `dryRun`, or the response documentation states that the flag is accepted but has no effect on a costs import. The test in `test/openapi-contract.test.ts` passes.

## What was done

The route's own comment already said that saying so "is more honest than
accepting it silently" — written in B677, and never implemented. A `costs`
import that is sent `dryRun` now answers with `dryRun: false` and a `note`
saying the flag changes nothing because a costs import never writes, and that
what came back is the whole read.

Not refused: refusing a harmless flag helps nobody, and a caller sending it is
usually being careful rather than wrong.

`/openapi.json` now marks the field `gps` only, and says what happens when a
costs import is sent one. Two tests pin it — one that the note appears, one
that a call *without* the flag says nothing about it, so the answer does not
grow noise for everybody else.

Found by a Haiku subagent asked to capture whatever it found while reading the
import route. It is a small thing and a real one.
