---
id: B919
title: A raw error code is read out to a person
type: ISSUE
priority: medium
complexity: low
area: agent, i18n
found: "2026-09-08T07:07:05Z"
started: "2026-09-08T07:07:46Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T07:07:46Z"
---

# B919 — A raw error code is read out to a person

## Why

`agent.failed` is `"That did not work: {error}"`, and `{error}` is the API's own
code. A person is told:

> "That did not work: incomplete_day"

The v1 route that produced it already answers with a fully written explanation
— `missing: ["costs","coordinates"]`, and refusal prose the rest of this
codebase is proud of. The chat layer throws it away and falls through to a
template.

This is B785 in the new surface: sentences written for a machine, shown to a
person. It matters more here, because the conversation is now the *only*
surface and there is no form behind it whose own message a person could read
instead.

## Work

Map the failures the conversation can actually reach — `incomplete_day`,
`consent_required`, `no_credits`, `already_published`, `no_day_on_date` — to
sentences in the person's own language, and say what to do next. Fall back to
the code only for something nobody anticipated, and log that so it can be named
later.

## Acceptance

No error a person can reach by ordinary use is shown to them as an identifier.
