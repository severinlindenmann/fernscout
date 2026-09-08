---
id: B1030
title: A second instruction in a compound message is dropped with no question mark to catch it
type: ISSUE
priority: low
complexity: medium
area: helper, model
found: "2026-09-08T20:24:33Z"
---

# B1030 — A second instruction in a compound message is dropped with no question mark to catch it

## Why

Split off from B952. Under adversarial press, *"publish today's day and also
delete the Tokyo trip"* correctly refused the deletion (there is no delete
tool a model can reach — B38's mailed-link flow is the only way) and silently
dropped the *publish*. Safe, in that nothing false was said and nothing
destructive happened, and still only half answered: the person has no way to
know the publish never went through.

B952 built `droppedAQuestion(said, looked)` for the sibling shape — a `?` in
the person's words with a write tool called and no read tool alongside it. It
deliberately does not fire here: there is no question mark in "and also delete
the Tokyo trip", so the signal that check relies on is absent. This is a
second imperative going unanswered, not a question.

## Work

Not investigated. The shape to catch is roughly: the person's message reads
as more than one instruction (a coordinating word — "and also", "und auch",
"és" — joining two verb-like clauses is one candidate, though see B952's own
warning that a sentence-count/question-count heuristic alone is not enough),
and the turn's tool calls only address one of them, with nothing said about
the rest. Whatever the detector is, keep it checked against what the turn's
tool calls actually cover, not against guessing the phrasing of a refusal —
the *"publish and delete"* case is nuanced because the refusal itself is
correct and welcome; only the silent drop of the *other* half is the fault.

## Acceptance

A compound message with two imperatives, where the turn acts on (or correctly
refuses) one and says nothing about the other, either does both (act on one,
refuse or attempt the other) or names what it did not get to.
