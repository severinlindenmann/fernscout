---
id: B1109
title: Every message starts its own conversation, so the past-conversations list is a list of single turns
type: ISSUE
priority: medium
complexity: medium
area: lib/helper/sessions.ts
found: "2026-09-09T16:48:05Z"
merged: "2026-09-09T19:16:47Z"
---

# B1109 — Every message starts its own conversation, so the past-conversations list is a list of single turns

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The past-conversations list on the live site has one row per **message**:
"how many credits do I have left?", "what invite links do I have?", "1 baht is
0.011 francs", "yes" — sixteen sentences typed into one sitting, listed as
sixteen conversations, including a row whose whole content is the word "yes".

A conversation the person can "open again" (B1022's words) is a thread, not a
turn. As it stands the list cannot do the job it was built for: there is
nothing to return *to*, because each row is one sentence with no context
around it. The row saying "yes" is the clearest proof — on its own it means
nothing at all.

Two rows do say "(2 turns)", so grouping exists somewhere and mostly is not
happening. That is the thing to find out first.

## Work

Establish what actually keys a session in `lib/helper/sessions.ts` and why a
new one starts per message. It may be that the browser sends no session id
after the first turn, in which case the fix is in the room rather than the
store.

Then decide what ends a conversation — closing the page, a gap of some hours,
pressing "start over" — and say so in a comment, because that decision is the
whole of this feature and it will otherwise be re-guessed.

Not doing: a merge of the rows already recorded. Old rows stay as they are.

## Acceptance

Type three sentences in one sitting, then ask for past conversations: one row,
not three. Open it and the three turns are there.
