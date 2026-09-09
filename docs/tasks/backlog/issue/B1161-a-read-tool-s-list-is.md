---
id: B1161
title: A read tool's list is still said back in prose, so the answer appears twice
type: ISSUE
priority: high
complexity: low
area: lib/helper/model.ts, components/HelperAsk.tsx
found: "2026-09-09T19:32:20Z"
---

# B1161 — A read tool's list is still said back in prose, so the answer appears twice

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B1120 fixed this at the tool's `describe`: `past_conversations` was told its
block already lists the rows and to say one sentence at most. Checked on the
live site after deploying, the model does it anyway — four clickable rows under
"Past conversations", then a paragraph underneath beginning *"You have 18
earlier conversations. The most recent was about making your trip visible to
guests. Others include renaming your journal to Reisen mit Renate…"*.

So the describe did not hold, which is the finding rather than a surprise:
**AGENTS.md already says rewording did not fix any of these and a code guard
fixed all of them** (B829, and every ticket since). B1120 reached for words
because words were cheap; this is the second half of the same lesson.

B1128 is the sibling — `invites` and `inbox` have the same shape and were left
alone — and it should be closed by whatever this builds rather than by three
more sentences.

## Work

A guard in `lib/helper/model.ts`'s net, built the way every other one there is:
a matcher for the claim, a condition on what the turn actually did, one retry
telling the model what it got wrong, and a plain sentence in the person's own
language when the retry fails too.

The condition is the part that makes it a guard rather than a word filter: the
server holds both halves, so it knows a turn returned a block that already
lists things **and** that the answer text enumerates the same items. Neither
alone is enough — a sentence naming one row is fine, and a list block with a
one-line summary is the intended shape.

Not doing: more words in a `describe`. That was tried and is what this ticket
is about.

## Acceptance

Ask for past conversations on a running instance. The rows appear once. The
same holds for `invites` and `inbox`, which closes B1128.
