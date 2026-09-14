---
id: B1744
title: There is no way to tell whether a change to the conversation made it better or worse
type: FEATURE
priority: high
complexity: medium
area: helper, whatsapp, testing
found: "2026-09-14T17:41:22Z"
started: "2026-09-14T17:41:49Z"
merged: "2026-09-14T18:06:41Z"
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

## What it found on the first day

**Two of its own numbers were wrong before any of the product's were.** Both
are written into `scripts/helper-bench.mts` as comments, because a harness
that lies is worse than none:

- Reading `helper_sessions` straight after a WhatsApp turn races
  `void recordTurn(…)`, which `dispatch.ts` deliberately does not await. It
  scored a working scenario **0 of 8**. The bench now reads the held proposal
  and the replies that actually went out.
- `lib/idempotency.ts`'s `store` is a module-level Map that outlives a
  scenario's temporary journal, so numbering wamids from zero in each run made
  every run after the first a silent `"replay"`. Another false zero.

Corrected, the baseline is **34/40**:

| scenario | | |
| --- | --- | --- |
| card-to-trip-named (web) | 8/8 | |
| card-to-trip-vague (web) | 5/8 | B1742's own shape |
| card-to-invite (web) | 8/8 | |
| card-to-trip-whatsapp | 8/8 | |
| day-from-a-note (whatsapp) | 5/8 | the channel's core flow |

**The first prompt rule it was pointed at was rejected.** A sentence telling
the model that an answer to its own question settles that question —
plausible, and the obvious fix for B1742's loop — scored **7/12 against a
9/12 baseline** on `card-to-trip-vague`, for thirty tokens and a ceiling
raise. Not shipped. That is the first time a prompt change in this repository
has been refused on evidence rather than argued about, and it is the whole
reason the script exists.

**And it found a defect nothing else would have.** In about one run in six the
model reads the journal's trips, sees Ungarn 2026, and proposes creating a
second Ungarn 2026 — captured as **B1746**, with a guard rather than a
sentence, on the strength of the rule above having failed.

## Acceptance

- `npm run helper:bench` runs the corpus and prints a pass rate per scenario.
- It is absent from `npm run verify` and says plainly that it spends money.
- A baseline is recorded for the corpus as it stands.
- B1742 is decidable with it. **Done**: at twelve runs the candidate rule
  loses, 7/12 to 9/12, and B1742's remaining failure is now two named modes
  rather than one vague one — a duplicate `create_trip` (B1746) and a turn
  that proposes nothing.
