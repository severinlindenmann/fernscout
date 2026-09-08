---
id: B930
title: The prompt budget has one token of headroom and does not say what to do
type: CHORE
priority: medium
complexity: low
area: agent, tests
found: "2026-09-08T08:25:31Z"
started: "2026-09-08T15:56:42Z"
merged: "2026-09-08T16:00:23Z"
---

# B930 — The prompt budget has one token of headroom and does not say what to do

## Why

`test/helper-thread.test.ts` caps the system prompt plus every tool's schema
and `describe` at a token count. The number is sound and its history is
excellent — five stacked paragraphs, each saying what a raise bought and what
sentence it replaced, which is why it is trustworthy.

**What the test does not carry is the procedure.** The assertion is a bare
`toBeLessThan`, so the failure reads `expected 4101 to be less than 4100` and
nothing else. Somebody who hits it at 2am sees a number a person set, does not
feel entitled to move it, and pays for the space out of description quality
instead — which is what happened four times out of five on 2026-09-08. The
reasoning that would have stopped that is in comments above the test, which a
failing run does not print.

The title said one token of headroom; that was true at 3,699 against 3,700.
B931 and B932 have since raised it to 4,100 and it sits at 4,059.

## Work

Put the procedure where a failing run prints it, and leave the number alone.
Not doing: raising 4,100. Today's evidence is that the room found each time was
real, so it has not yet been the wrong number.

## Acceptance

A failing run tells the reader what to look for before raising the ceiling.

## What happened on 2026-09-08

The ceiling was hit **five times in one day** and was not raised. Each time the
answer was to find the space, and four of those five cost description quality —
a phrase trimmed here, an example dropped there, because the alternative was
raising a number a person had set.

The fifth found the actual fat, and it is worth writing down because it will
keep growing back: **the prompt argues each rule at length, and each retry
argues the same rule again at the moment it is needed.** By then the honesty
net had seven retries, several of them almost word for word a paragraph of the
prompt.

So the split is now: **the prompt states the rule, the retry makes the case.**
Four paragraphs came down to four sentences and the ceiling stopped binding,
with nothing the model needs upfront removed — the argument still reaches it,
later and at the only moment it matters.

That is a rule for whoever picks this up rather than a closure: the ticket is
still about whether 4,100 is the right number. What today says is that it has
not yet been the *wrong* one, and that the room found each time was real.


## Outcome (2026-09-08)

The ceiling is a named constant used by both the assertion and its message, so
the two cannot disagree, and the message carries the order of questions: is the
same thing said here *and* in an honesty retry, a tool's `describe`, or a
refusal in `lib/helper/intents.ts`? The prompt states the rule; the retry makes
the case. Raising is legitimate — in its own commit, with a paragraph saying
what the tokens bought.

The comment above the test now says the same at length, including the one trade
that is **not** acceptable: cutting a `describe` until a tool gets chosen
wrongly. At Haiku's input price four hundred tokens is a fraction of a rappen a
turn, against a wrong write in somebody's journal.

**The number is unchanged at 4,100**, currently sitting at 4,059 — 41 tokens of
headroom. Whether 4,100 is right is still the open question this ticket asks,
and nothing here answers it; what changed is that meeting it no longer costs
quality by default. Checked by temporarily lowering the constant and reading
the message a person would actually see.
