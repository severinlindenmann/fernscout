---
id: B942
title: A proposal to set a day's words opens on an empty box no press can accept
type: ISSUE
priority: high
complexity: low
area: helper, entries
found: "2026-09-08T10:11:42Z"
started: "2026-09-08T10:12:02Z"
merged: "2026-09-08T10:23:55Z"
---

# B942 — Pressing a proposal to set a day's words with an empty box erases them

## Why

`set_day_words` fills its `content` field with `args.content ?? ""`
(`lib/helper/tools.ts`), so a proposal the model makes without supplying prose
puts an **empty box** in front of somebody, under a sentence saying it will set
the day's words. Every press of it fails: `lib/api/entries.ts:1244` refuses
empty content, and the card comes back `content must not be empty`.

**Nothing is lost — that guard is doing its job**, and this ticket was first
written claiming the day was erased. It is not. What happens is B929's shape
again: a proposal on somebody's screen that no press can accept, with the
reason written in a language nobody chose to read.

The same line is why B941 goes wrong from the other side. A person saying
*"it should say udon, not ramen"* is editing one word of a paragraph, and with
the box empty the model has to reproduce the whole paragraph from memory to do
it. Expensive, easy to get wrong, and the reason it reached for `add_cost`
instead — which, pressed, would have doubled the recorded spend and left the
wrong word on the page.

## Work

The field opens on what the day already says — `found?.entry.content` — rather
than on nothing. The proposal becomes pressable, and a correction becomes a
small edit in a visible box, which is the shape a person expects.

`title` already falls back this way. `content` is the one field that was
missed.

Not doing: relaxing the empty-content guard. A day with no words is not a
thing this software has ever let somebody make, and a person who wants one is
asking to delete the day.

## Acceptance

TODO

## Why

`set_day_words` fills its `content` field with `args.content ?? ""`
(`lib/helper/tools.ts`), so a proposal the model makes without supplying prose
puts an **empty box** in front of somebody, under a sentence saying it will set
the day's words. `PATCH /api/helper/<user>/day` then treats an empty string as
a value — `typeof body.content === "string"` is true for `""` — and
`editEntry` writes it.

So the press erases everything already written on that day. There is no
confirmation beyond the one the person has already given, and nothing on the
card says the box being empty is the point.

Found while looking at B941, which is the same field from the other side: a
person saying *"it should say udon, not ramen"* is asking for a correction, and
a correction needs the existing words to correct. Today the model has to
reproduce the whole day's prose from memory to change one word, which is both
why it is expensive and why it reached for the wrong tool instead.

## Work

The field opens on what the day already says — `found?.entry.content` — rather
than on nothing. That closes the erasure and makes a correction a small edit in
a visible box, which is the shape a person expects.

Emptying a day deliberately is then still possible: clear the box and press.
That is a person doing it with the words in front of them, which is the whole
difference.

Consider whether the same holds for `title`, which already falls back to
`found?.entry.title`. It does — this is the one field that was missed.

## Acceptance

A test that proposes `set_day_words` for a day with prose and no `content`
argument, and fails if the field comes back empty — so the proposal it makes
is one that can actually be pressed.
