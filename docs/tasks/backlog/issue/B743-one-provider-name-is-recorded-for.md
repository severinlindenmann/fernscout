---
id: B743
title: One provider name is recorded for three different consents
type: ISSUE
priority: medium
complexity: low
area: agent, consent
found: "2026-09-07T12:46:56Z"
---

# B743 — One provider name is recorded for three different consents

## Why

`lib/helper/consent.ts:47` — `HelperConsent.provider` is a single string, but
there are now three scopes and **two providers**: `words` and `photos` go to
Anthropic, `speech` goes to Deepgram.

So agreeing to speech overwrites the provider recorded against the words
consent. That file's own comment promises "a change of provider is not silently
covered by an old yes", and after B686 that promise holds only in the panel
text a person reads, not in the record the file keeps. The record is the part
that has to be true a year later.

## Work

A `providers` map keyed by scope, replacing the single string. Keep reading the
old shape — a file written before this change has one provider and the scopes
it was granted for.

## Acceptance

A journal that agreed to words (Anthropic) and speech (Deepgram) has both
recorded, and changing either provider re-asks only for that scope.
