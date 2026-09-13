---
id: B1665
title: Agent work consumes avoidable context and verification time without measured quality feedback
type: CHORE
priority: medium
complexity: high
area: agent workflow, context, tests, CI, developer tooling
found: "2026-09-13T12:56:53Z"
---

# B1665 — Agent work consumes avoidable context and verification time without measured quality feedback

## Why

Fernscout has invested heavily in making agent work safe, but it has not
measured the cost or effectiveness of that harness as a system. Every session
is told to read the whole 1,191-line, 73,665-byte `AGENTS.md`; a selected skill
can add another 10–20 KB; and the latest local full gate took roughly five
minutes, with the Vitest phase alone running more than 570 files. The repository
has good advice to run one focused test while iterating, but no machine-readable
map from a changed area to the tests, docs, contracts, personas and browser
checks that protect it. Agents rediscover that graph with searches and can
still either run too much or miss a keeper.

There is no baseline that answers the questions this chore is meant to improve:
tokens read before the first useful edit, time to the first trustworthy test,
full verification time, retry/rework rate, or escaped mistakes. Without those
measurements, shortening instructions can remove the one safety rule an agent
needed, while an apparently faster test mode can merely stop exercising shared
state. Optimisation must preserve or improve quality, not exchange it for a
smaller number.

Current primary guidance points in the same direction:

- Anthropic recommends the smallest high-signal context, progressive
  disclosure and just-in-time retrieval rather than loading an entire corpus
  up front: <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>.
- Its long-running-agent work uses explicit feature state, incremental clean
  commits and structured handovers so a fresh context does not re-derive the
  project: <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>.
- Its tool guidance recommends concise/detailed response modes, actionable
  errors and evaluation-driven refinement: <https://www.anthropic.com/engineering/writing-tools-for-agents>.
- Next.js 16.3 recommends version-matched bundled docs, runtime visibility,
  error-driven iteration and skills for multi-step workflows:
  <https://nextjs.org/docs/app/guides/ai-agents>. Its supported MCP bridge can
  expose route metadata, compilation issues and dev-server logs directly:
  <https://nextjs.org/docs/app/guides/mcp>.
- Vitest says to measure before changing isolation or pools (`vitest doctor`),
  supports persisted module/Node compile caches, and supports file sharding for
  large suites: <https://vitest.dev/guide/improving-performance>.
- Next.js documents persisting `.next/cache` between builds, and GitHub Actions
  supports dependency caches and parallel matrix jobs:
  <https://nextjs.org/docs/13/pages/building-your-application/deploying/ci-build-caching>
  and <https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching>.

## Work

Run this as a measured programme, not a broad rewrite. Commit the baseline and
experiment results so a later agent can reproduce every adopted or rejected
choice.

### 1. Establish the baseline and quality corpus

- Choose at least ten representative completed tasks: API/schema, database,
  helper/model guard, ordinary UI, visual/browser, provider simulation and
  documentation/skill work. Include at least three historical defects where a
  plausible implementation passed a narrow test but violated a repository
  rule.
- Add a repeatable benchmark command that records cold-start instruction bytes,
  tool calls/bytes returned, time to first edit, focused-test time, full-gate
  time, retries, final failures and which required checks the agent selected.
  Store aggregate results, never conversation content, credentials or journal
  data.
- Make correctness the primary score: acceptance met, relevant keepers pass,
  no unrelated diff, no weakened assertion, and browser/persona/contract checks
  selected when the feature calls for them. Tokens and time are secondary.

### 2. Make context progressive and discoverable

- Audit `AGENTS.md` for universal safety rules versus domain explanations.
  Keep a short root routing layer and move detailed material behind explicit
  links, scoped skills or nested `AGENTS.md` files that load with the relevant
  subtree. Do not remove publishing consent, privacy boundaries, task gates,
  destructive-action rules or verification requirements merely to win a token
  metric.
- Generate or maintain a compact agent index mapping capabilities and paths to
  their owning modules, tests, skills, local docs and browser/persona flows.
  Provide a command that accepts a task id or changed paths and returns the
  concise slice first, with a detailed mode for identifiers and reasoning.
- Remove duplicated instructions where one canonical reference can be loaded
  just in time. Add a keeper that catches stale or broken references and makes
  its error tell the agent exactly which source to update.

### 3. Shorten the trustworthy feedback loop

- Profile current Vitest phases and slow files, then run `vitest doctor` and
  controlled repeated trials of threads versus forks, safe non-isolated
  projects, `test.dir`, filesystem module cache and Node compile cache. Adopt a
  setting only when repeated runs remain deterministic; tests that mutate
  process state, filesystem state or a shared Postgres schema stay isolated.
- Add a safe changed-path/related-test command backed by the agent index and
  Vitest's dependency graph. It must explain which tests it selected and fall
  back to a broader group when the mapping is uncertain. It accelerates the
  edit loop; it never replaces the full pre-merge gate.
- Replace the judgement call behind `verify --quick` with a content hash or
  stamp over route structure and generated types. Rebuild automatically when
  the route graph changed; otherwise reuse valid output and say why that is
  safe.
- Measure worktree setup and repeated Next builds. Trial a documented worktree
  bootstrap, persistent Vitest/Node caches and Next's `.next/cache` without
  sharing writable build directories between concurrent agents.
- Trial the official Next.js runtime/MCP diagnostics as an optional local
  adapter. Keep a shell/browser fallback so no proprietary agent client becomes
  required to contribute.

### 4. Parallelise only where isolation is real

- Measure two to four Vitest shards for the SQLite CI leg and merge their
  reports. A Postgres shard needs its own database/schema; never point parallel
  destructive shards at the one `POSTGRES_TEST_URL` used today.
- Review repeated `npm ci` and build work across CI jobs and reuse supported
  caches or immutable artifacts where this demonstrably reduces wall time.
  Preserve the production-dialect, backup, Caddy and systemd keepers even when
  they remain slower specialist jobs.

### 5. Turn mistakes into harness improvements

- Run the representative corpus before and after each candidate change. Record
  which instructions, tool outputs or missing mappings caused failures, and
  improve the harness from observed failures rather than adding speculative
  prose.
- Produce a small structured handover artifact for long tasks: objective,
  decisions, changed files, checks run, failures still open and next action.
  Reuse ticket/plan/brief data instead of keeping a second narrative that can
  disagree.
- Add adversarial keepers for the critical workflow: attempts to publish
  without consent, cross-journal reads, browser-dialog regressions, skipped
  visible checks and weakened tests must not score as successful work.

Do not optimise model prompts, product-facing helper prompts, or application
runtime performance in this ticket. This is the repository and development
harness used by coding agents. Do not require one vendor: Claude Code, Codex
and a plain shell-based agent must all retain the documented path.

## Acceptance

- A committed baseline report and command reproduce measurements across at
  least ten representative tasks and three known failure cases without storing
  private content or credentials.
- The default root context is at least 30% smaller by bytes, while every
  universal safety rule is still automatically in scope and the quality corpus
  has no regression.
- The median changed-file-to-trustworthy-focused-test loop is at least 25%
  faster on the benchmark machine. The command lists why each test was chosen
  and safely broadens its selection for an unknown path.
- A full local verification and the SQLite/Postgres CI coverage retain their
  existing checks. Any sharding, isolation or cache change passes at least ten
  consecutive runs without a new intermittent failure.
- Stale `.next/types` can no longer make the quick path report unrelated type
  errors: it either proves the route graph is unchanged or runs the build.
- An agent starting from a task id can retrieve a concise map of the relevant
  code, tests, docs, skills and visible checks; detailed output remains
  available on demand.
- At least one measured improvement ships in each of context use, test/build
  feedback, and mistake prevention. The final report records rejected
  experiments as well as adopted ones, with before/after tokens, wall time and
  correctness results.
