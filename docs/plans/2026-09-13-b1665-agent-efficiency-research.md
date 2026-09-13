# B1665 — Agent-efficiency research

Researched 2026-09-13 against `main` at `77342432`, Node 24.20.0,
Next.js 16.3.3 and Vitest 4.1.11 on the maintainer's macOS checkout.

## Conclusion

Fernscout does not first need a new agent platform. Its largest measured costs
come from four local, fixable shapes:

1. the root instructions exceed a supported agent's automatic instruction
   limit;
2. two test files dominate the full suite because they serialize independent
   shell scenarios or wait on real clocks;
3. there is no safe bridge between a changed file and the tests that guard it;
4. the task command agents are told to run emits the whole 1,622-ticket index.

Do those before CI sharding, MCP integration or a broad documentation rewrite.
They improve all supported agents and do not make correctness depend on a
vendor. A realistic first target is to put the root instructions below 28 KiB,
cut the ordinary local Vitest wall time from 174 seconds to below 90, and make
the normal task/test discovery calls return less than 10 KiB unless detailed
output was requested.

## What was measured

### Context and discovery

| Input | Measured size | Finding |
| --- | ---: | --- |
| `AGENTS.md` | 1,191 lines; 12,161 words; 73,665 bytes | Always required by this repository. |
| Codex default project-instruction limit | 32 KiB | Official OpenAI documentation says combined project instructions stop at this limit by default. |
| First 32 KiB of `AGENTS.md` | 535 lines | Ends mid-sentence in the focused-testing paragraph; localisation, API-contract, worktree, task, skill and network-door sections follow it. |
| Domain/content-model block, lines 51–477 | 26,049 bytes | Valuable reference, but not needed before every task. |
| Work/task/skill/network-door blocks, lines 637–1191 | 34,826 bytes | Useful by task, but too large to be implicit startup context together. |
| Selected repository skills | 3,686–21,490 bytes each | Already progressive: only the matching skill is meant to be read. |
| `npm run tasks` output | 1,654 lines; 26,492 words; 159,783 bytes | The first discovery command in `manage-tasks` returns every task. |
| `npm run tasks -- list open` | 160,181 bytes | `list` ignores the requested lane, so there is no concise supported form. |
| `docs/tasks/INDEX.md` | 282,994 bytes | Good human index; poor default agent context. |

The instruction limit is not theoretical. Official Codex guidance says it
concatenates instruction files from repository root to working directory and
stops when `project_doc_max_bytes` is reached, 32 KiB by default. Raising a
personal setting would make this checkout work only for one operator. The
repository should fit the supported default and link to details.

Nested `AGENTS.md` files are useful only when an agent starts with a working
directory below them. Fernscout agents usually start at the repository root,
so ordinary linked reference documents and selected skills are the reliable
progressive layer; nested instructions can supplement them for contributors
who launch inside `app/`, `lib/` or `test/`, but cannot be the only route to a
rule.

### Test feedback

A clean JSON-reporter run passed 575 test files and 7,579 tests, with six
skipped. The interval from the first file starting to the last file ending was
173.639 seconds. Summed per-file runtime was 497.324 seconds because files run
in parallel.

| Observation | Result |
| --- | ---: |
| Files taking at least 1 second | 52 |
| Files taking at least 5 seconds | 11 |
| `test/backup-script.test.ts` | 170.647 seconds; 37 tests |
| `test/photobook-print.test.ts` | 80.781 seconds; 11 tests |
| Share of summed file time from those two | 50.6% |
| Share from the ten slowest files | 64.5% |
| Test files touching `process.env` | 340 |
| Test files using temp-directory patterns | 326 |
| Test files spawning or executing subprocesses | 15 |
| Test files selecting jsdom | 31 |
| Uses of `test.concurrent` / `describe.concurrent` | 0 |

The two largest costs have different causes:

- `test/photobook-print.test.ts` exercises a production settlement window with
  `SETTLE_POLL_MS = 4_000` and a 20-second deadline. Five passing tests each
  spend about 16 seconds waiting for a mocked provider that will never change.
  This should use an injected clock/sleeper or fake time. Keep one small test of
  the integration boundary; do not make eleven unit/integration assertions
  wait on a wall clock.
- `test/backup-script.test.ts` contains 37 shell scenarios in one file. Vitest
  parallelises files, not the tests within this shared-fixture narrative, so
  this one file is the suite's 171-second critical path. Split it by concern
  behind a shared fixture factory—allowlist/staging, repositories, Postgres,
  timeouts/failures, reporting—so each file gets Vitest's existing process
  isolation. Do not mark the current tests concurrent inside one file: they
  share environment and fixture state.

Global `isolate: false` is therefore the wrong first experiment. Hundreds of
files mutate environment or filesystem state, and B738 records why intra-file
ordering is significant in narrative suites. The installed Vitest does support
fork/thread pools and file sharding, but a global isolation change has a high
correctness risk and attacks less runtime than the two known critical paths.

The ticket originally proposed `vitest doctor` because the current Vitest web
guide documents it. The installed 4.1.11 CLI has no `doctor` command. Use a
checked-in benchmark script that runs explicit configurations instead; revisit
`doctor` only after an independently justified Vitest upgrade.

### Test selection

Vitest 4.1.11 already supplies `related` and `--changed`. A trial against
`lib/theme.ts` selected five files and 68 passing tests in 5.6 seconds. That is
useful and incomplete: repository keepers such as brand-token scans, undefined
colour scans and some generated/localisation checks read files as data and do
not import the module, so the dependency graph cannot discover them.

The safe design is a union:

1. Vitest's dependency-related files;
2. a small checked-in keeper registry mapping path globs to tests or commands;
3. an explicit broader fallback when neither has evidence.

The command must print its reasoning. For example, changing a theme module
could say “five dependency-related files; plus brand, undefined-token and
locale keepers because `lib/theme.ts` matches their declared globs.” A newly
added route with no mapping should select route/API/contract keepers rather
than return an empty green run. The full `npm run verify` remains the merge
gate.

### Build, worktrees and CI

- The main checkout currently holds 677 MB of `node_modules` and 875 MB of
  `.next`, with 19 registered worktrees. `work-on-a-task` already uses APFS
  copy-on-write (`cp -Rc`) for dependencies, so “replace `npm ci` in every
  worktree” is already solved on this machine. Automating that documented
  bootstrap can prevent mistakes, but it is not the next speed win.
- `verify --quick` trusts a person or agent to remember whether the route tree
  changed. Hashing route paths, the Next version and the route-type-affecting
  configuration at build time would make that decision deterministic. A stale
  stamp should trigger the build, not refuse or emit unrelated TypeScript
  errors.
- CI already separates jobs, caches npm downloads, and runs SQLite and
  Postgres in a matrix. There are five `npm ci` steps, but those jobs are
  parallel, so removing repeated install work may reduce compute without
  shortening the critical path. Measure Actions timings before changing it.
- Vitest sharding is suitable after the two long files are fixed. Each CI
  matrix job has its own runner and Postgres service, so Postgres shards can be
  isolated there; multiple local shard processes must never share today's one
  destructive `POSTGRES_TEST_URL`.
- Next.js 16.3's MCP bridge can expose compilation issues, routes and runtime
  logs. It is a useful optional adapter, but the repository already has a
  browser evidence script and bundled version-matched docs. It ranks below
  fixing the known context and test costs, and must not become the only path.

## Recommended build order

### Wave 1 — high confidence, directly measured

1. **Put root instructions below the supported default.** Target at most
   28 KiB, leaving headroom for Next's managed block. Keep universal safety,
   authority, task gates, destructive-action rules, the verification contract
   and a short map in root. Move detailed content model, API/network doors,
   worktree mechanics and skill catalogue explanations into canonical linked
   documents. Add a byte-limit test and a broken-link keeper.
2. **Remove real time from photobook settlement tests.** Inject time into the
   polling helper or use controlled fake time, preserving assertions about the
   number and order of provider checks.
3. **Split the backup critical path.** Extract its fixture/shim setup and divide
   scenarios into independently isolated files. Run ten full suites under load
   to guard against the flake class described by B249, B713 and B1106.
4. **Give tasks a concise interface.** Add `tasks show B1665`, `tasks search
   <words>`, and `tasks list --lane open|backlog|… [--category …]`. Keep the
   current exhaustive listing behind `--all`; update task skills to use the
   narrowest command.

Expected result: root startup context falls by more than 60%; common task
discovery falls from about 160 KB to a few KB; and the suite loses its two
largest artificial serial waits. These changes need no model-specific API.

### Wave 2 — safe focused feedback

5. **Add `npm run check:changed`.** Union `vitest related` with a keeper
   registry and print every selected check and reason. Empty/unknown mappings
   broaden, never silently pass. Record selection precision and recall against
   at least ten completed tasks before recommending it in a skill.
6. **Make `verify --quick` self-validating.** Store a route-type stamp after a
   successful build and rebuild on mismatch. Keep the ordinary full verify
   command unchanged.
7. **Automate worktree preflight.** One repository command creates or checks a
   task worktree, clones dependencies on APFS or uses `npm ci --prefer-offline`
   elsewhere, confirms the branch/cwd, and reports stale dependencies. This is
   primarily the durable fix path for B1462 and B1483, not a claimed test-speed
   improvement.

### Wave 3 — quality measurement

8. **Create a Fernscout agent benchmark.** Use 8–12 completed tickets at their
   pre-fix commits plus four seeded workflow mistakes. Run baseline and
   candidate instructions with the same model/configuration at least three
   times where budget permits. Grade hidden tests, acceptance, prohibited
   actions, unrelated diff, selected checks, correction turns, wall time and
   input/output bytes. Store aggregate metrics and patches; never store secrets,
   cookies, personal content or raw conversations.
9. **Use failures to change the harness.** Every instruction added must point
   to an observed benchmark or production failure. Prefer a deterministic
   command, schema, hook or actionable error when prose has already failed—as
   B1462's repeated background-verify stalls demonstrate.
10. **Then measure sharding and caches.** Trial two to four test shards,
    persistent Vitest/Node compile caches and an isolated copy-on-write Next
    cache. Accept only changes that improve repeated median wall time and stay
    clean across ten consecutive runs.

## What not to do first

- Do not raise Codex's personal instruction limit. That hides the repository
  defect on one machine and increases mandatory context instead of curating it.
- Do not disable Vitest isolation globally. The suite's environment and
  filesystem profile makes the risk measurable.
- Do not trust `vitest related` alone. Static source-scanning keepers are
  invisible to an import graph.
- Do not add retries to make flakes green. Preserve the existing rule that a
  red test is diagnosed, not retried away.
- Do not make MCP or one model vendor required. The strongest four wins are
  ordinary repository changes.
- Do not fold B1049 or B1449 into this work. Those concern Fernscout's
  product-facing helper model and its tool prompt; B1665 concerns coding agents
  working on this repository.

## Benchmark acceptance

The ticket's original percentage goals become useful only with stricter
boundaries:

- root `AGENTS.md` is at most 28 KiB, all universal rules remain implicit, and
  linked reference coverage is tested;
- a clean local Vitest run is below 90 seconds at the median of five runs on
  the same machine, with the same skips and no keeper removed;
- task lookup and changed-check discovery each default below 10 KiB of output;
- changed-check recall is 100% for the declared required checks of the ten-task
  corpus; extra checks affect precision, not correctness;
- ten consecutive full suite runs introduce no new flake;
- the agent corpus has no correctness regression, no increase in forbidden
  actions, and fewer median correction turns. Token/time improvements are not
  accepted when that gate fails.

## Primary sources

- OpenAI, **Custom instructions with AGENTS.md** — discovery order, nested
  scope and the 32 KiB default limit:
  <https://developers.openai.com/codex/agent-configuration/agents-md>
- OpenAI, **Model guidance** — audit loaded skills/instructions and calibrate
  verification to the change:
  <https://developers.openai.com/api/docs/guides/latest-model>
- Anthropic, **Effective context engineering for AI agents** — minimal
  high-signal context, progressive disclosure and just-in-time retrieval:
  <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- Anthropic, **Effective harnesses for long-running agents** — incremental
  work, explicit progress and clean handovers:
  <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>
- Anthropic, **Writing effective tools for AI agents** — concise outputs,
  actionable errors and evaluation-driven tool design:
  <https://www.anthropic.com/engineering/writing-tools-for-agents>
- SWE-agent paper — agent-computer interface design materially affects coding
  performance: <https://arxiv.org/abs/2405.15793>
- SWE-bench paper — repository issue/patch/test pairs as an evaluation shape:
  <https://arxiv.org/abs/2310.06770>
- Next.js, **AI Coding Agents** and **Next.js MCP Server** — bundled
  version-matched docs and optional runtime visibility:
  <https://nextjs.org/docs/app/guides/ai-agents> and
  <https://nextjs.org/docs/app/guides/mcp>
- Vitest, **Improving Performance** — isolation, pools, persisted caches and
  sharding; version-check every option against the installed CLI:
  <https://vitest.dev/guide/improving-performance>
