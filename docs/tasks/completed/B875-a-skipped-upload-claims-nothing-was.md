---
id: B875
title: A skipped upload claims nothing was lost when something was
type: ISSUE
priority: high
complexity: low
area: media, api
found: "2026-09-07T17:41:38Z"
merged: "2026-09-07T18:16:17Z"
completed: "2026-09-09T16:47:11Z"
---

# B875 — A skipped upload claims nothing was lost when something was

## Why

Every upload the deduplicator discards is answered `201 ok:true` with:

> "already had this one — **nothing was lost**"

For an exact-bytes match that is true. For a perceptual match it is an opinion
stated as a fact, and B872 shows the opinion is often wrong: a tester lost 38
photographs to it in one run, each one reported this way.

The two cases are not the same kind of claim and must not share a sentence.
Identical bytes is something the server knows. "Looks like one you already
have" is something it guessed.

AGENTS.md puts the rule plainly: "it was accepted" must not be a different
claim from "it is there". This is that failure with a reassurance attached.

## Work

Split the message. For identical bytes, say so — that sentence can keep its
confidence. For a perceptual match, say what actually happened: this looked
like an existing photograph, name which, and say whether it was kept or not.

Being fixed alongside B872, which is the reason the sentence matters.

## Acceptance

No response claims nothing was lost unless the server knows it.
