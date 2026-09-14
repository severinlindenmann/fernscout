---
id: B1744
title: There is no way to tell whether a change to the conversation made it better or worse
type: FEATURE
priority: high
complexity: medium
area: helper, whatsapp, testing
found: "2026-09-14T17:41:22Z"
started: "2026-09-14T17:41:49Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-14T17:41:49Z"
---

# B1744 — No way to tell whether a change to the conversation made it better

## Why

Every rule the helper follows is a sentence in `threadSystemPrompt` or a tool
`describe`, and changing one is a **behavioural claim**: "the model will now
do X". Nothing in this repository can check such a claim. `npm run verify`
runs the mechanism — that `stagedContact` finds a card, that a proposal's
arguments are a body its route accepts — and says nothing about whether the
model reaches for the tool at all.

The cost of that gap, on one day:

- **B1737** shipped a `contact` argument so the conversation would stop asking
  for an address it already had. A prompt sentence was cut during the build to
  fit `test/helper-thread.test.ts`'s token ceiling. Nobody could tell whether
  that mattered. The owner hit the failure live within the hour.
- **B1742** then tried to answer it. Three rounds of measurement were thrown
  away because the probe called `answerInThread` directly and the selection
  line is composed by `app/api/helper/[user]/ask/route.ts`, not by
  `answerInThread` — so the model was answering without knowing which card was
  ticked, which is not the situation anybody is ever in. Every conclusion
  before that was found was void.
- With the mistake fixed, the deployed code proposed correctly **4 times in 6**
  and the candidate fix **5 in 6** — a difference inside the noise. The ticket
  had to be left unfixed, because six runs cannot choose between two prompts.

So the position today is: a prompt change can only be argued for, never shown,
and the argument is settled by whoever is holding the keyboard. That is how
B1737's sentence was cut and how B1742 could not be closed.

**The ceiling test is the sharpest illustration.** `helper-thread.test.ts`
guards the prompt's token budget and its own comment says a raise must be paid
for with "a paragraph saying what the tokens bought" — the budget is measured
to the token and the *benefit* is measured not at all.

## Work

A benchmark, not a test: it calls a real model, costs real money and is
nondeterministic, so it must never enter `npm run verify`.

Follow `scripts/agent-benchmark.mjs`'s shape, which already solved this for a
different question — a script, a corpus under `docs/benchmarks/`, `--out`
JSON, medians rather than single runs.

- `scripts/helper-bench.mts`, run as `npm run helper:bench`, the same
  `tsx --conditions=react-server` other scripts that import `lib/` use.
- A corpus of scenarios, each naming the ticket it came from: a world to stage
  (trips, inbox, days), the turns to say, the channel(s), and what a good
  answer does.
- **Both doors.** The web room through the composition `/ask` really performs
  — selection line included, because that omission is what voided B1742 — and
  WhatsApp through `handleInboundMessage`, the way `test/whatsapp-*.test.ts`
  already drive it.
- Expectations in a small closed vocabulary: which tool was proposed, an
  argument's value, a tool that must *not* run, and words the answer must not
  contain (an address it already holds).
- `--runs N` per scenario, a pass rate per scenario and overall, `--only <id>`,
  `--channel`.

Seed it from what is already evidenced rather than imagined: B1742's two
shapes, B1737's WhatsApp shape, B1743's typed press, and the invite the owner
originally asked for.

## Acceptance

- `npm run helper:bench` runs the corpus and prints a pass rate per scenario.
- It is absent from `npm run verify` and says plainly that it spends money.
- A baseline is recorded for the corpus as it stands.
- B1742 is decidable with it: run the two prompts, at a sample size where the
  answer is not noise, and say which wins.
