---
id: B1754
title: The bench scores one clarifying question as total failure, which is not how the product is meant to work
type: ISSUE
priority: high
complexity: low
area: helper, testing
found: "2026-09-14T20:25:42Z"
started: "2026-09-14T20:26:02Z"
merged: "2026-09-14T20:44:35Z"
completed: "2026-09-15T08:19:23Z"
---

# B1754 — One clarifying question is scored as total failure

## Why

`scripts/helper-bench.mts` runs a single-message wording as exactly one turn.
If that turn does not propose, the case fails. So an answer that asks one
sensible question — *"welches Datum war heute?"* — scores the same as one that
invents a trip, offers a menu, or says nothing useful at all.

That is not how this product is meant to work, and the prompt says so in its
own words: *"call the write tool as soon as you understand what they want"* —
**as soon as you understand**. A message that genuinely does not carry a date
is one the model is supposed to ask about. AGENTS.md is on the same side: an
empty field beats a plausible fiction, and the corpus has a whole scenario
(`garbled-input`) asserting that nonsense must *not* produce a write. The
benchmark currently rewards the opposite instinct everywhere else.

It is also not what the field does. The clarification benchmarks measure
*turns to resolution* and penalise **inefficient** questioning — a question is
friction to be minimised, not a failure to be punished. ClarEval's ATC
("average turns to clarify") and EAR are the shape; τ-bench's `pass^k` is the
neighbouring idea for reliability across repeats.

So `day-from-a-note` at 24% is **not** a trustworthy 24%. Some unknown part of
it is the model asking one reasonable question and the harness calling that a
loss. Until that is separated out, B1752's numbers are an upper bound on the
badness and nothing more.

## Work

- **`nudges`** on a scenario: canned replies the runner sends, in order, only
  while nothing has been proposed — the smallest honest stand-in for a user
  who answers the question they were asked. A date, a "ja", a trip name.
- **Report two numbers, not one**: resolved on the first turn, and resolved
  within the nudges. The gap between them *is* the clarifying-question rate,
  which is the number nobody has today.
- Keep the first-turn figure visible. A question is friction: a scenario that
  needs two nudges every time is worse than one that proposes straight away,
  and the report must not hide that behind a single rolled-up pass rate.
- `garbled-input` and `half-said-day` must **not** get nudges — there the
  question is the right answer and there is nothing to resolve to.

## As built, and what it changed

`nudges` are canned answers the runner sends only while nothing has been
proposed, per locale, and never on a scenario that asserts a refusal. The
report now carries two figures side by side — resolved at all, and resolved
without having to ask — because a question is friction and a single rolled-up
rate would hide it.

On the core day flow, over the same 84 cases:

```
before   20/84   24%
after    54/84   64%  ( 24% straight away, 34 after a question)
```

Forty points of B1752 were this, not the product. Its headline is withdrawn
and its evidence restated.

## And the bill, which nobody was watching

Four full sweeps in one afternoon cost about **twenty US dollars**, and not one
of them printed a number before or after. That is a benchmark people stop
running. So:

- **A sample by default** — two wordings per scenario per locale, taken by
  striding the list rather than off the front, because the tidy wordings are
  written first and a prefix would quietly test only the easy half.
- **An estimate before, a real figure after.** The estimate is measured
  (~$0.006 a case); the figure at the end is `lib/usage.ts`'s own rows priced
  from `site/config.json`'s own rates, so it is the arithmetic `/admin` does.
- **A ceiling.** Past 150 conversations it says what it will cost and stops
  unless `--yes` is passed.

Worth a look separately: `usage` records raw input tokens, and 8 cases billed
47k of them — about 6k each against an 8.5k system-and-tools prefix that
B1450 marks for caching. Either the cache is not being hit across bench calls
or the row is pre-cache; if it is the former, that is most of the bill.

## Acceptance

- `day-from-a-note` reports both figures, and the ticket records the gap.
- B1752's evidence is re-stated against the resolved-within figure, or
  withdrawn if that figure turns out to be healthy.
- No scenario that asserts a refusal gains a nudge.
