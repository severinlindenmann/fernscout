---
id: B744
title: The speech consent panel names Deepgram even on a dry-run instance
type: ISSUE
priority: low
complexity: low
area: agent, i18n
found: "2026-09-07T12:46:57Z"
---

# B744 — The speech consent panel names Deepgram even on a dry-run instance

## Why

`agent.speechConsent` names Deepgram in the panel, even on an instance running
the `dry-run` backend, where the recording goes nowhere and no third party
hears anything.

Same shape as B492's dry-run note for the print providers: the panel has no way
to read `speechProvider()` today, so it says the alarming thing unconditionally.
Telling a self-hoster their voice goes to a company it does not go to is a small
lie in the direction of caution, which is the better direction — and still a
lie.

## Acceptance

The panel names the provider actually configured, and says plainly when nothing
leaves the instance.
