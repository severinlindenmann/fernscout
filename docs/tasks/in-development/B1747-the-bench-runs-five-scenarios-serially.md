---
id: B1747
title: The bench runs five scenarios serially, so it cannot cover the conversation or be run often
type: FEATURE
priority: high
complexity: medium
area: helper, whatsapp, testing
found: "2026-09-14T19:41:27Z"
started: "2026-09-14T19:42:10Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-14T19:42:10Z"
---

# B1747 — The bench cannot cover the conversation or be run often

## Why

B1744 built the instrument and proved it works: it rejected a plausible prompt
rule on evidence and found B1746. But as it stands it has five scenarios, one
phrasing each, one locale, and it runs them one at a time in one process. That
is a demo, not coverage.

Three things stop it growing:

- **One phrasing per scenario.** The failures this repository keeps finding are
  phrasing failures — "setze X auf die Namensliste" works 8 times in 8 and
  "auf ungarn reise" works 5 times in 8. A corpus with one wording per
  situation measures the wording, not the situation.
- **One locale.** The owner writes German; the demo is English. A rule that
  works in one and not the other is invisible today.
- **Serial, in one process.** `withWorld` sets `CONTENT_DIR` and `DATA_DIR` as
  process environment, so two scenarios cannot run at once in the same
  process by construction. A hundred scenarios at the current rate is over an
  hour, which means nobody will run it.

## Work

**Expansion, not more JSON.** A scenario becomes a template with its wordings
per locale, and the runner expands channels x locales x wordings into cases.
Ten readable blocks become a hundred cases. A case id is
`<scenario>/<channel>/<locale>/<n>` so `--only` can still name exactly one.

```json
{ "id": "card-to-trip", "channels": ["whatsapp", "web"],
  "says": { "de": ["setze {name} auf die Namensliste von {trip}", ["auf {trip}", "ja"]] } }
```

A wording is a string or an array of strings — one turn or a conversation.
Locales come from the keys of `says`, never from a list beside it, so a
locale cannot be claimed without wordings to back it.

- **`--jobs N` over child processes**, not promises. The environment is
  process-global and that is not worth fighting: shard the case list, spawn
  `node` per shard, aggregate. Each child prints JSON and nothing else.
- **`--against <baseline.json>`** prints the delta per scenario and exits
  non-zero when a scenario drops — that is what makes it usable before a
  merge rather than only during an investigation.
- Keep the assertions **mechanical**. No model grading the model: the
  instrument's own noise is the one thing that cannot be measured away, and
  B1744 already spent an afternoon on two false zeroes of its own.

## As built

Templates expand `channels x locales x wordings`; `--jobs` shards over child
processes; `--against` reports deltas and exits non-zero on a drop of ten
points or more. `test/helper-bench-corpus.test.ts` checks the corpus in the
ordinary suite — shape, unique ids, and above all that every tool a scenario
names still exists.

Two additions the first broad sweep forced, both of which had the bench lying
about the product:

- **`calls`, beside `proposes`.** A read tool answers with a block and never
  proposes, so `proposes: "trips"` could not match however well the product
  behaved. Three scenarios read 0% and went to 77%, 72% and 78% the moment the
  expectation named the right thing.
- **`world.days`.** A cost has nowhere to land on a journal with no days, so
  the honest answer — "there is no day yet" — was scored a failure. 0% to 51%
  with a day staged. Both authors of the new scenarios had flagged the missing
  day staging before the sweep did.

Neither was a product defect, and both would have been reported as one.

## Acceptance

- A scenario with three German wordings and two channels expands to six cases,
  each separately addressable by `--only`.
- `--jobs 4` produces the same per-scenario totals as `--jobs 1`.
- `--against` reports per-scenario deltas and fails on a regression.
- The corpus README (or the script header) says what a run costs, in money.
