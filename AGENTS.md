<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fernscout, for agents

Read this file in full before working. It is the short, universal contract for
every task in this repository. Detailed material is linked by topic below and
is loaded only when the task reaches that topic. After context compaction,
recover this file, the active task and the selected skill rather than starting
over.

Repository skills live in `.claude/skills/<name>/SKILL.md`; `.agents/skills/`
links to the same tracked source. When a request matches a skill, read its
whole `SKILL.md` before acting and follow any directly required references.
Tool names in a skill describe capabilities, not a required vendor.

Fernscout is a self-hostable travel journal. A person's content is JSON
documents and photographs in a folder they own. There is no CMS: an agent is
the editor, including the model behind `/agent`. Read the scoped references
when the task needs their detail:

| When the task concerns | Read |
| --- | --- |
| trips, days, photographs, weather, visibility, people, costs, imports or GPS | [Content model and editorial safety](docs/agents/content-model.md) |
| local development, tests, localisation, API schemas or contracts | [Repository verification](docs/agents/repository-verification.md) |
| branches, worktrees, task lanes, holds or task ids | [Worktrees and tasks](docs/agents/worktrees-and-tasks.md) |
| repository skills, visual workbenches or optional plugins/tools | [Skills and tools](docs/agents/skills-and-tools.md) |
| authentication, invites, credits, printing, deletion or the network API | [Network and authorisation](docs/agents/network-and-auth.md) |

## Rules that are always in scope

### Tell the truth about content and actions

Write only what the person or a real source supplied. Never invent weather,
places, meals, feelings, measurements, people or memories. An empty field is
better than plausible fiction. A source label you invented is still fiction.

New days are drafts. Publishing is a separate owner-only call, and it requires
the person's explicit consent in words. Ask and wait. “It looks finished” and
silence are not permission. Never say an action succeeded because it was
proposed, queued or attempted: report what the turn actually did.

`test: true` is the only exception for invented content. A whole test journal
is named `test-<something>` so the label survives exports and backups.

GPS history under `content/<user>/gps/` is the most sensitive data in the
repository. Never expose it, copy a coordinate from it into content, or add a
route that reads it. The public map uses only a derived, clipped
`trips/<trip>/track.json`.

A photograph upload keeps the original as its print master. Do not replace or
discard originals while working on served derivatives.

### Preserve authority boundaries

Agent bearer tokens reach `/api/**`, not rendered owner pages. Owner pages use
browser cookies. An identity cookie proves an email address and grants nothing
by itself. Use the established resolution functions; never make credentials
interchangeable for convenience.

An invite link creates a request, not access. A postcard or photobook API call
creates a proposal, not a paid print. A delete API call creates a confirmation
email and removes nothing. Report those states exactly and never claim the
second, human-only step happened.

Secrets are environment-only and never enter `site/config.json`, source,
fixtures, task files or logs. Nothing personal belongs in application code;
`test/depersonalised.test.ts` enforces the source directories.

Anything touching authentication, tokens, grants, visibility or an API route
needs the repository's security review path before merge. A finding that
already existed is a new backlog ticket; a defect introduced by the branch is
fixed on the branch.

### Keep implementation portable and closed by default

Local development is SQLite and production is Postgres. Nothing outside
`lib/db/` chooses the dialect. Every optional capability is off by default and
must be absent, not broken, when disabled; `lib/capabilities.ts` decides and
`/api/health` explains.

No feature requires a paid provider account to develop or test. Use the
repository's dry-run, simulated provider and local mail paths.

Do not use `window.confirm`, `alert` or `prompt`. Confirmations use
`components/ConfirmPanel.tsx` with an action-specific button.

Prefer the smallest implementation that satisfies the task. Do not introduce
a dependency, abstraction, platform or vendor requirement without measured
need. A fresh clone must remain workable without one operator's plugins or
local configuration.

## Verification contract

The final local gate is one command:

```bash
npm run verify
```

It runs build, TypeScript, ESLint, Vitest and knip in the required order. Run a
single relevant test file while iterating, for example:

```bash
npx vitest run test/thing.test.ts
npm run check:changed -- path/to/changed-file.ts
```

`check:changed` combines Vitest's dependency graph with declared source-scan
keepers, prints why each check was selected, and broadens to the full suite
when neither source has evidence.

Use `npm run verify -- --quick` only after this worktree has built and no route
was added, moved or deleted since. Next generates route types during the build;
stale `.next/types` produces unrelated TypeScript errors. When uncertain, run
the full gate.

A visible change is not verified by the suite. Drive a real browser against
content that existed before the branch at desktop and phone width, inspect the
screenshot and the captured JSON, and check console and request failures. Do
not verify only on a fixture authored for the change. Use `test-in-a-browser`;
for an SVG, animation, card or print layout use `check-a-drawing`.

Keep every existing keeper unless the ticket explicitly changes its contract.
Do not weaken assertions, add retries to hide flakes, or exchange coverage for
a faster number. A focused changed-file check accelerates iteration only; it
never replaces the pre-merge gate.

### UI strings

A new UI string needs real English, German and Hungarian entries in
`site/locales/`. Run `npm run i18n:keys` after changing English. If you cannot
write a language, say so and leave the task short of done rather than inventing
a translation.

### API routes and contracts

Anything under `app/api/` must keep the public contract truthful. `/api/v2/**`
contracts come from the Zod schemas in `lib/api/v2/schemas/` and generate
`/api/v2/openapi.json`; surviving v1/auth operations are maintained in
`lib/api/openapi.ts`. Import enum constants from their validator source rather
than copying lists. Every accepted field must be readable back, and limits must
be discoverable before a caller hits them. Run the `keep-the-contract` skill
after an API change.

## Where work happens

The shared checkout stays on `main` and clean. Task files are the sole
exception: capture, lane moves and edits to a task's own Markdown are committed
directly on `main` so concurrent sessions can see them. Every other file—code,
tests, docs, skills, config and content—is changed in a dedicated branch and
worktree under `.claude/worktrees/`.

Before a merge, confirm the shared checkout says `main` and has no unrelated
changes:

```bash
git rev-parse --abbrev-ref HEAD
git status --short
```

Never work in or remove a worktree you did not create. A new worktree has no
dependencies; on this APFS machine clone them copy-on-write:

```bash
cp -Rc node_modules .claude/worktrees/<branch>/node_modules
```

Do not symlink `node_modules`. If `package-lock.json` moved after rebasing or
merging main, refresh the clone. On a filesystem without copy-on-write, use
`npm ci --prefer-offline`.

In a worktree-isolated harness, issue one git command per shell call. Complex
chained commands may be refused because their working directory cannot be
proved. Two builds in the same checkout contend on Next's build lock; builds
in separate worktrees do not.

A dispatched subagent cannot enter or manage a worktree. The parent creates
it, supplies its absolute path and dependencies, and later merges. The
subagent uses that absolute working directory for every tool call and never
merges, checks out, pushes or removes the worktree.

## Task workflow

The folder is the status:

```text
backlog/ ──person──▶ open/ ──take──▶ in-development/ ──merge──▶ testing/ ──person──▶ completed/
```

`open/` and `completed/` are human gates. An agent moves into either only when
the person explicitly says so in that turn for that task. Anything newly
noticed goes to `backlog/`; do not quietly absorb it into the current task.
Agents stop at `testing/`, where a person verifies the result.

Use the task command instead of reading the whole 1,600-ticket index:

```bash
npm run tasks                              # counts plus active work
npm run tasks -- list --lane open          # one lane
npm run tasks -- show B01                  # one complete task
npm run tasks -- search "words"            # capped matching list
npm run tasks -- list --all                # exhaustive, only when needed
npm run tasks -- new --type ISSUE --priority high --complexity low \
  --area "…" --title "Problem, not solution"
npm run tasks -- move B01 in-development
npm run tasks -- move B01 testing
```

Never choose an id or move a task file by hand. `tasks new` allocates across
all worktrees and reserves the id; `tasks move` stamps and files it. Backlog is
categorised from `type` and `complexity`; run `npm run tasks -- tidy` after
changing either. Never hand-edit generated tables in `docs/tasks/INDEX.md`.

Take work only from `open/`. Revalidate the complete ticket and named code
before moving it to `in-development/`, then record `valid`, `already fixed`,
`superseded by <id>` or `premise is wrong` in the ticket. A `wontDo` decision
belongs to a person. Update the task as implementation changes what is known.

Follow `manage-tasks` for capture and lane rules and `work-on-a-task` for the
full isolated build/merge procedure.

## Skill router

Use only the matching skill and its required references:

| Skill | Use it for |
| --- | --- |
| `manage-tasks` | Capture, inspect and move task files |
| `work-on-a-task` | Build one approved task in an isolated worktree |
| `triage-a-backlog` | Review a whole backlog lane |
| `plan-a-run` / `run-a-batch` / `report-a-run` | Prepare, execute and report an approved batch |
| `test-in-a-browser` | Verify a page locally at desktop and phone widths |
| `check-a-drawing` | Inspect SVG, animation, card and print visuals |
| `test-a-feature` | Exercise capability/persona flows locally |
| `test-the-live-site` | Verify tickets against the deployed instance |
| `test-with-personas` | Independent guided-helper persona testing |
| `keep-the-contract` | Audit API schemas, docs and read-back behavior |
| `get-a-credential` | Obtain the correct local/live test identity |
| `apply-the-brand` | Brand colors, logo, wordmark and related UI |
| `github` | GitHub Actions, pull requests and issues |
| `deploy` | Ship to the VPS and verify health |

Optional plugins and local hooks do not exist in a fresh clone and cannot be a
required path. Detailed setup, workbench routes and tool caveats live in
[Skills and tools](docs/agents/skills-and-tools.md).
