---
id: B1020
title: A chip in the opening skips the consent gate and dead-ends on a panel that is not there
type: ISSUE
priority: high
complexity: low
area: helper, ui
found: "2026-09-08T19:34:51Z"
merged: "2026-09-08T19:55:55Z"
---

# B1020 — A chip in the opening skips the consent gate and dead-ends on a panel that is not there

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The chips in the room's opening call `ask()` directly. The text field does not
— it calls `go()`, which checks consent first and opens the panel when there is
none (`components/HelperAsk.tsx`: `if (consented) void ask(); else
setConsenting(true)`).

So a first-time owner who presses **Neuer Tag** before agreeing to a model
being spoken to gets:

> Nothing was written: this journal has not yet agreed to a model being spoken
> to. Agree on the panel above, then press again.

There is no panel above. It is a dead end, reached by pressing the brightest
thing on the screen, by exactly the person least able to work out what happened
— somebody who has never used this before.

The chips were built as *"a shortcut for typing"*. They took a shortcut past
the gate the typing goes through, which is the whole of the bug: a shortcut
that skips a step is not the same thing said faster.

## Work

The chips go through `go()`, or through whatever `go()` is refactored into, so
that pressing one is exactly typing it and pressing Ask. Then look at the
sentence itself — *"agree on the panel above"* names something that may not be
above, and B928 is the ticket about telling people to press what is not there.

## Acceptance

Pressing a chip on a journal that has not consented opens the consent panel,
the same as typing the sentence would. A test that presses a chip without
consent and finds the panel rather than the error.
