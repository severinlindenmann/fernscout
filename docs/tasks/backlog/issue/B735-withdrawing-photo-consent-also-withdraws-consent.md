---
id: B735
title: Withdrawing photo consent also withdraws consent for words
type: ISSUE
priority: low
complexity: low
area: agent, consent
found: "2026-09-07T12:22:18Z"
---

# B735 — Withdrawing photo consent also withdraws consent for words

## Why

B687 split helper consent into scopes — `words` and `photos` — so that
agreeing to send your notes is not taken as agreeing to send your photographs.
That part is right and is the whole reason the split exists.

But `revokeHelperConsent` deletes the file, and both the words panel and the
photos card call it. So somebody withdrawing permission for *photographs* also
silently withdraws it for their words, and the next write-up asks again with no
explanation of why.

Consistent with the one-file design, and still surprising to the person doing
it — which is the only test that matters for a permission.

## Work

Give `revokeHelperConsent` a scope that rewrites the file rather than deleting
it, and delete only when the last scope goes.

## Acceptance

Withdrawing photo consent leaves the words consent standing, and the panel says
which one was withdrawn.
