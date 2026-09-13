# Agent-efficiency benchmark

`corpus.json` names ten completed Fernscout tasks across API/schema, database,
helper/model, UI, visible, provider and skill work. Three cases record failures
where narrow verification or the wrong credential gave a plausible but wrong
result. It contains repository paths and check names only—never journal data,
credentials, conversation text or model reasoning.

Run the deterministic discovery benchmark and optionally commit its aggregate:

```bash
npm run agent:benchmark
npm run agent:benchmark -- --out docs/benchmarks/agent-efficiency/results/candidate.json
```

For repeated agent trials, collect one structured row per run and aggregate it
without retaining conversations:

```bash
npm run agent:benchmark -- --score /path/to/run-metrics.json \
  --out docs/benchmarks/agent-efficiency/results/model-trial.json
```

The input is `{ "runs": [...] }`. Each row requires `caseId`, `variant`, the
non-negative numeric fields `instructionBytes`, `toolCalls`, `toolOutputBytes`,
`timeToFirstEditMs`, `focusedTestMs`, `fullGateMs`, `retries`, `finalFailures`
and `forbiddenActions`; `selectedChecks` is an array; and `acceptanceMet`,
`unrelatedDiff` and `weakenedAssertion` are booleans. Unknown fields are
refused so raw prompts, messages, credentials or content cannot accidentally
enter a committed result. Correctness is the primary score: acceptance met,
no unrelated diff, no weakened assertion, no forbidden action and no final
failure. Time and bytes are reported only beside that gate.
