# Delivering the helper with subagents

*Written 2026-09-07, before the work. How B681–B689 and B694 get built by
parallel sessions without treading on each other. The what is in
`2026-09-07-web-helper-agent.md`; this is only the how.*

## The shape of the problem

Ten tickets, one feature, one repository, several agents at once. Three things
make that hard here, and every rule below exists for one of them:

1. **Merging is serial even when building is parallel.** Two agents can write
   at once; only one may merge at a time, and only from the main checkout.
2. **Some files everything wants.** `lib/capabilities.ts`, `site/config.json`,
   `site/locales/*.json`, `docs/tasks/INDEX.md`. A ticket that touches one of
   these must not be in flight beside another that does.
3. **A subagent cannot tell you it was wrong.** It reports success in the same
   voice either way, so the checks have to be mechanical and the human gates
   have to stay where they are.

## Waves

Each wave is merged, verified on `main`, and moved to `testing/` before the
next begins. Never two tickets in flight that appear in the same row of the
collision table below.

| Wave | In parallel | Why not sooner |
| --- | --- | --- |
| 1 | **B681** alone | Everything mounts on `/agent`. Its layout, its session handling and the bring-your-own panel are the conventions the rest copy |
| 2 | **B682** ‖ **B694** | The wizard, and the landing page that points at it. Disjoint files: `app/agent/` versus `components/LandingSections.tsx` + locales + docs |
| 3 | **B683** ‖ **B684** | Upload transfer, and the model layer. Both need the wizard merged. Disjoint: `lib/api/media.ts` versus `lib/helper/` |
| 4 | **B685** ‖ **B687** | Router and vision. Both sit on B684's model layer and neither adds a capability |
| 5 | **B686** ‖ **B688** | Transcription (its own capability) and signup. B686 must not overlap B684, which also edits `lib/capabilities.ts` |
| 6 | **B689** alone | Needs the inbox landing behaviour from B683 and a screen from B682 |

Six waves, ten tickets, roughly two agents at a time. Two is the cap, not a
target: each worktree is a full `npm ci`, and a third agent mostly waits for the
merge queue.

## The collision table

One in-flight ticket per row. This is the whole reason for the wave order.

| File | Claimed by |
| --- | --- |
| `lib/capabilities.ts`, `lib/config.ts` (`FEATURE_NAMES`) | B684 (`helper`), then B686 (`transcription`) — never together |
| `site/config.json` | B681 (`agent` reserved) |
| `components/LandingSections.tsx` | B694 |
| `lib/api/media.ts`, the media route | B683 |
| `lib/api/openapi.ts`, `/agent.md` | whoever changes a route that wave — at most one |
| `site/locales/{en,de,hu}.json` | everyone, unavoidably |
| `docs/tasks/INDEX.md` | the main checkout only, never a worktree |

**Locales are the exception that needs a convention rather than a lock.** Every
ticket appends keys under its own prefix (`helper.*`, `landing.*`, `agent.*`)
in one contiguous block. A conflict there is then always resolved by taking
both sides, which a merger can do without reading either ticket.

## Who does what

**The person** promotes each wave's tickets from `backlog/` into `open/`. That
is the only gate in the loop and it is not an agent's to open — an agent
promoting its own capture and then starting it skips the single review step in
the whole process. It is six decisions across the batch.

**The parent session** (the one holding this plan) does everything that touches
the shared checkout:

- creates each worktree and hands over its absolute path;
- moves tickets between lanes and commits the task files on `main`;
- merges, one at a time, and runs `npm run verify` on `main` after each merge;
- files anything a subagent reports as a finding, with a real id from
  `npm run tasks -- new`;
- removes the worktree and deletes the branch.

**A subagent** builds one ticket in one worktree and stops. It never merges,
never edits `docs/tasks/`, never runs `npm run tasks`, and never touches a
worktree it did not receive.

The split is not ceremony. Lane moves committed on a branch are invisible to
every other session until that branch merges, by which time they have stopped
being useful — which is exactly what the lanes are for.

## Dispatching one ticket

The parent, before dispatch:

```bash
git worktree add .claude/worktrees/<id-slug> -b <id-slug>
npm run tasks -- move <ID> in-development     # in the main checkout
git add -A docs/tasks && git commit -m "<ID>: taken"
```

Then the subagent, with this prompt shape. Everything in it is load-bearing;
each line is something that has gone wrong here before.

```
You are building exactly one ticket in an isolated git worktree.

WORKTREE (absolute, work only here): /Users/…/.claude/worktrees/<id-slug>
TICKET:   docs/tasks/in-development/<ID>-….md   — read it first, in full
CONTEXT:  AGENTS.md, and docs/plans/2026-09-07-web-helper-agent.md

Before writing code:
  cd into the worktree and run `npm ci`. A worktree has no node_modules;
  tsc, eslint and vitest resolve upward and appear to work, and the build
  does not.

Rules:
  - Build ONLY what this ticket says. Anything else you notice, report it
    at the end in words — do not fix it, do not widen the ticket.
  - Do not merge. Do not switch branches. Do not touch docs/tasks/.
  - Do not use run_in_background for anything, verify included.
  - One git command per shell call. `cd x && git log && git diff` is
    refused by the harness as unverifiable, and that is a wasted turn.
  - No window.confirm/alert/prompt. Use components/ConfirmPanel.tsx.
  - A route change means lib/api/openapi.ts and /agent.md change too.

Finish by running `npm run verify` in the worktree and pasting its real
output. Commit everything to your branch — an uncommitted file in a
worktree blocks the merge.

Report back: the branch name, what you built, the verify output, what you
deliberately did not do, and anything you found that deserves its own
ticket.
```

Then the parent, and only after reading the report rather than trusting it:

```bash
git -C <main> rev-parse --abbrev-ref HEAD      # must say `main`
git -C <main> merge --no-ff <id-slug>
npm run verify                                 # on main, after the merge
npm run tasks -- move <ID> testing
npm run tasks -- index
git worktree remove .claude/worktrees/<id-slug>
git branch -d <id-slug>
```

`npm run verify` runs **twice** on purpose: green in a worktree only says the
branch is sound in isolation. The merge is where two green branches make a red
`main`, and it has happened.

## Which model

Sonnet for the mechanical tickets — B686, B687, B688, B694 — where the shape is
decided and the work is following it.

Opus for **B682, B683 and B684**, and it is worth the money in exactly these
three: the wizard is the product's whole feel, the upload is concurrency and
resume, and the model layer is money plus consent plus a rule about not
inventing things. A cheap agent that gets any of those subtly wrong costs more
than the difference.

## What must not be automated

- **`completed/` is a person's.** An agent stops at `testing/` and says what to
  look at. A ticket is done when somebody has seen it working.
- **Every one of these tickets is a page**, and no test tells you whether a
  page is usable at 390px. `test-in-a-browser` on every UI ticket, and it is
  the parent's job, not the builder's — the agent that wrote it is the worst
  judge of it.
- **B681 and B684 go through `claude-security` before they merge.** One is
  auth and a handover credential; the other spends money and holds a consent
  record. Each finding is a capture or an argument for why it is not.
- **`keep-the-contract` after B683 and after every helper route.** The tests
  catch an undocumented route; they cannot catch a sentence that is untrue.
- **A subagent's "it works" is not evidence.** The verify output is. Paste it,
  read it, and if it is missing, assume it was not run.

## Failure modes already seen in this repository

Each of these cost a session before it was written down.

| | |
| --- | --- |
| A worktree with no `node_modules` | `npm run build` fails in a way that reads as a broken merge |
| `cd <worktree> && git log && git diff` | refused as too complex to verify; twelve wasted turns across ten sessions |
| A subagent backgrounding `npm run verify` | it stalls, reports nothing, and the session waits forever |
| Uncommitted work left in a worktree | the next merge refuses to start |
| An id chosen by hand | four sessions all called their capture B130; duplicates are permanent |
| The shared checkout on a detached HEAD | commits are real, reachable, and on no branch |
| Two agents in one checkout | one silently builds on the other's half-finished work |

`npm run tasks` reports the last two by itself, from any checkout, about every
checkout. Run it at the start of every wave.
