# Compose eval — B2692

A runnable judge of `composeDay` (`lib/helper/compose.ts`, B2688): a golden
set of real days from an owner's own journal plus hand-written hard cases,
run through the composer, dumped for judging, and merged into one report.

**API credit is scarce.** The composer is the only model this harness calls
by default — judging is free by default too: `run.mts` writes `cases.jsonl`
and `judge-instructions.md` and stops; a person or a subagent reads both and
writes `verdicts.jsonl` by hand, then `report-cli.mts` merges it with no
model call at all. `EVAL_JUDGE=api` spends more credit to have a cheap model
judge too, if there is budget for it.

## Running it on the owner's own journal

```bash
EVAL_CONTENT_DIR=/Users/severin/Documents/GitHub/fernscout/fernscout-helper/content \
EVAL_USER=severin \
npm run eval:compose
```

This **reads the owner's content read-only** (never writes under
`EVAL_CONTENT_DIR`) and **writes results outside this repository**
(`EVAL_OUT`, default `/tmp/claude-501/eval-compose/<timestamp>/`) — never
back into `content/`, never committed.

Without `EVAL_CONFIRM=1` this is a dry run: it prints which days it picked
and the planned call count and cost, and calls no model. Add `EVAL_CONFIRM=1`
to actually run the composer:

```bash
EVAL_CONTENT_DIR=/path/to/fernscout-helper/content EVAL_USER=severin \
EVAL_CONFIRM=1 npm run eval:compose
```

## Env vars

| var | default | |
| --- | --- | --- |
| `EVAL_CONTENT_DIR` | this repo's `content/` | read-only; set `CONTENT_DIR` for the duration of the run |
| `EVAL_USER` | `example` | whose journal to pull the golden set from |
| `EVAL_DAYS` | `20` | how many real days to pick (spread across trips, short/long) |
| `EVAL_MODEL` | `modelFor("compose")` | the composer model, single-model mode |
| `EVAL_PAIR` | — | `modelA,modelB` — runs both, dumps both for a pairwise judge |
| `EVAL_JUDGE` | `off` | `api` spends extra credit to judge with a model too |
| `EVAL_JUDGE_MODEL` | `modelFor("small")` | only read when `EVAL_JUDGE=api` |
| `EVAL_OUT` | `/tmp/claude-501/eval-compose/<timestamp>/` | never inside the repo |
| `EVAL_CONFIRM` | — | `1` to actually call the composer; otherwise a dry run |

## The golden set and the hard cases

20 real days (`EVAL_DAYS`), picked by `build-golden.ts`/`select-cases.ts`:
spread round-robin across the journal's trips, and within each trip
alternating shortest/longest remaining day — so neither one chatty trip nor
one word-count bucket can fill the set alone. Deterministic: the same
content picks the same days every time, which is the whole point of a
*golden* set — a prompt change is judged against the same days before and
after.

9 synthetic "hard cases" (`hard-cases.json`, `test-eval-compose*` trip
titles, clearly invented people and places) exercise the truth rule
directly: a thin one-liner, sarcasm, mixed German/English notes, a memory
that contradicts the measured weather, a plan that must stay a plan, rough
lowercase German with typos, a photo-only day, long rambling notes (the
length cap), and a camera clock with no note giving a clock time.

## The pipeline

1. **`run.mts`** (`npm run eval:compose`) — builds the case set, prints the
   cost plan, and (only with `EVAL_CONFIRM=1`) runs `composeDay` for real,
   concurrency 3, and writes `cases.jsonl` + `judge-instructions.md` to
   `EVAL_OUT`. With `EVAL_PAIR` it also writes `pairwise.jsonl` (both
   models' output per case, for an external judge to compare in both
   orders).
2. **Judging** — read `judge-instructions.md`, which states the exact
   `verdicts.jsonl` line shape and the three rubrics (grounding against the
   pack; whether the entry ends with a summing-up line; whether the writer
   would publish it with at most light edits). Write one line per case per
   surviving variant. For a pairwise run, also write
   `pairwise-verdicts.jsonl`: one line per case per order (`"AB"`/`"BA"`),
   each the judge's pick for *that* order (`"first"`/`"second"`/`"tie"`) —
   never "A"/"B" directly, so the swap rule is applied once, in
   `pairwise.ts`, from the dump's own model names.
3. **`report-cli.mts`** (`npm run eval:compose:report -- --from <dir>`) —
   reads `cases.jsonl`/`verdicts.jsonl`/`pairwise*.jsonl` from `<dir>` and
   writes `report.md` beside them. No model call.

`EVAL_JUDGE=api` folds steps 1–3 into one `run.mts` call: it judges with
`EVAL_JUDGE_MODEL` itself and writes `report.md` directly (pairwise
comparisons are always external — `EVAL_JUDGE=api` does not auto-judge A vs
B, only each side's own grounding/ending/would-publish).

## What's in the report

Pass rates per judge (overall and per model), the deterministic
banned-phrase rate (code, never a judge), guard-drop counts bucketed by
reason, cost per day (from the usage ledger — `$0` shows as "unknown" when
no database is configured, never as zero), the five worst cases with their
notes and output, and — for a pairwise run — the tally with the swap rule
applied (`pairwise.ts`'s `tallyPairwise`).

## What this harness does not do

It never writes into `EVAL_CONTENT_DIR`, never copies a real day's text into
this repository (`cases.jsonl`/`report.md` land under `EVAL_OUT`, outside
the repo, by design), and — unless `EVAL_CONFIRM=1` is set by a person who
has just read the cost plan — never calls a model at all.
