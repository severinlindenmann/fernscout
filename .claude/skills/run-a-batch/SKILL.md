---
name: run-a-batch
description: Carry a batch of tickets a person already answered through build, merge, deploy and live check without asking anything else — reads plan-a-run's brief.json, builds groups concurrently, merges serially with npm run unused after each, deploys per wave, parks what fails three times, and ends with report-a-run. Use when the user says "run the batch", "run-a-batch", "build what I approved", or hands over a brief.json and asks for it to be executed.
---

# Run a batch

`work-on-a-task` does one ticket and stops at `testing/`. `vps` deploys.
`test-the-live-site` verifies a lane. Nothing joins them, which is why a
twelve-ticket batch used to be a day of a person typing between each of those
skills rather than an afternoon of watching one run. This skill is the join.

**Everything this skill needs was decided already.** `plan-a-run` asked every
question a build could hit, in one sitting, and wrote the answers to
`.claude/runs/<run-id>/brief.json` (that skill defines the file's shape — read
it there, not here, if you have not already). This skill reads that file once,
at the start, and does not speak to the person again until it hands the
finished run to `report-a-run`.

## The one rule

**No question reaches a person mid-run.** A decision that was not in the
brief is parked with its evidence and becomes a row in the final report — it
is never a prompt somebody was supposed to be watching for, because nobody is
watching. If you find yourself about to ask something, that is this skill
finding a gap in the brief, not a reason to break the rule: park it, keep
going, and say so loudly in the report.

The two things this buys, both backed by the evidence B1100's Why cites: an
orchestrated fleet has no natural bottleneck, so small mistakes compound
invisibly across every group that is running at once — the serialised merge
and the per-wave deploy below are that bottleneck, put back in on purpose.
And an agent stuck on the same failure for a third try does not get unstuck by
a fourth — it needs a budget and a park, not more attempts.

## Numbers, stated once

- **Concurrency cap: 3 groups in flight at once.** Reported ceiling for
  agents working genuinely independent state; a fourth group waits for a slot
  rather than starting.
- **Per-ticket budget: 3 failed verify cycles.** A third `npm run verify`
  failure on the same ticket parks it — see "Kill criteria" below.
- **Deploy is per wave, not once at the end.** A wave is "every group merged
  since the last deploy"; see "Waves" below.
- **Engagements run in their own lane, never inside a group.** A `type: OPS`
  ticket has no diff to merge; see "Engagements" below.

## Step 1 — read the brief, and only the brief

```bash
cat .claude/runs/<run-id>/brief.json
```

Every ticket in it either has `chosen` (an option, or `null` because there
were none to choose between) and every `questions[]` entry has an `answer`.
If either is missing on a live ticket (one not in `dropped`), stop and say so
— that is `plan-a-run`'s job unfinished, not something this skill guesses at.

Read `groups[]` directly from the file. **Do not recompute it.** `plan-a-run`
is the one place the grouping is decided (its Step 3), for the same reason
every fact in this codebase lives in one place: a grouping computed twice can
disagree with itself, and the way that shows up here is two worktrees editing
one file at once — B880, B881, B883 and B896 are four recorded instances of
exactly that, from clean branches that never touched the same ticket, let
alone the same brief.

A ticket carrying `type: OPS` also carries a `shape` block — read it now,
because it says how this ticket is scheduled, not what group it joins; it
never appears in `groups[]` and Step 2 below is not its path. See
"Engagements" below.

`dropped[]` tickets are done — they were already fixed, superseded, or wrong,
and `plan-a-run` said why. Nothing about them belongs in this run; mention
them in the final report as "planned but not built" and move on.

`blocked[]` tickets are never built — refuse outright rather than attempting
one, even inside a group of one. A dropped ticket was decided wrong or
already handled; a blocked one was never started at all, because its own Work
section names a prerequisite that does not exist yet (B1115's Why: B1058
against B1057 and B1064). The two are different facts and `report-a-run`
counts them separately — folding a blocked ticket into "parked" would say a
build was attempted and failed, when none was ever attempted.

## Step 2 — one worktree, one branch, per group — dispatch hierarchically

For each group, once (not per ticket in the group):

```bash
git worktree add .claude/worktrees/<group-name> -b <group-name>
cp -Rc node_modules .claude/worktrees/<group-name>/node_modules
```

Dispatch **one subagent per group**, on Sonnet, with the absolute worktree
path and that group's slice of the brief — its ticket ids, in order, each
with its `chosen` option (including the mockup HTML's contents, read and
pasted in — the subagent gets the file's actual markup, not a path it would
have to go find) and its answered questions.

That subagent's job, inside its own worktree, is to run **`work-on-a-task`
per ticket, sequentially**, through step 5 (verify) and stop **before** the
merge step — merging is this skill's job, serialised across all groups, not
each group's own. Two things it must be told explicitly, because
`work-on-a-task` does not know about a brief on its own:

- **Skip `work-on-a-task`'s own revalidation if the brief already carries a
  verdict for this ticket** — `plan-a-run` did that work; redoing it inside
  the group is the two-places problem again. If it is not in the brief for
  some ticket (should not happen for a live ticket, but check), do it there.
- **The chosen option travels to whatever verifies the ticket, not only to
  whatever builds it.** Say this to the subagent in words, because the
  recorded failure this guards against is exactly a reviewer who knew the
  ticket but not the plan, and passed work that built infrastructure nothing
  ever integrated. Concretely: when the subagent finishes a ticket, its own
  check against the Acceptance section reads the same `chosen` option this
  step handed it, not just the ticket file.
- **Kill criteria are the group agent's to enforce per ticket, not the
  orchestrator's** — see below. It moves on to the next ticket in its group
  rather than stalling the whole group on one parked ticket.

Launch every ready group's subagent **in one message** so they run
concurrently, up to the cap of 3. A group waiting for a slot starts as soon as
one finishes — merging, next.

## Kill criteria, without exception

**Three failed `npm run verify` cycles on one ticket** (build, tsc, eslint,
vitest, or knip — any of them, three attempts total) parks that ticket:

- leave its task file in `in-development/` — it is not testing/ material and
  it is certainly not `completed/`;
- write what failed, and the last attempt's actual output, to
  `.claude/runs/<run-id>/<ticket-id>/parked.md`;
- the group subagent moves on to the next ticket in its group rather than
  retrying a fourth time or stopping the group.

**A failed deploy** (below) parks every ticket in the wave that had not
already gone live, the same way — not just the one that broke the build.

A parked ticket is never silently dropped from the report; B1100's acceptance
is explicit that it is named, with what failed, and does not stop the other
tickets in the batch.

## Engagements — OPS tickets run their own lane

`work-on-a-task` turns a ticket into a diff; an **engagement** is the other
shape AGENTS.md names — findings and other tasks against the **running**
instance, not a diff — and this skill's group pipeline (worktree, branch,
verify, merge) has nothing for it to do. An OPS ticket never joins a group,
never gets a worktree, and never reaches Step 3. It has its own dispatch,
its own concurrency rule, and its own completion condition, all read from the
`shape` block `plan-a-run` already wrote onto it.

**It runs on its own, serialised against every other engagement.** Two
engagements dispatched together silently share whatever `shape.needs` names —
most often a per-IP rate-limit budget on a live auth route — and each assumes
it holds the whole of it. B103 and B101, the two OPS tickets in this
pipeline's first real run, both reported exactly this: `concurrencySafe:
false`, because `POST /api/auth/request` shares one bucket with anything else
touching the live site. Dispatch one engagement at a time, in the order the
brief lists them, and wait for it to report before starting the next.

**It may run alongside a build group only when `shape.target` names a
different instance from what the builds are merging into** — a `local`
engagement against a dev server can overlap a wave of `live` builds, but a
`live` engagement never overlaps another `live` thing, build or engagement,
because they would share the same rate-limit bucket and the same real data.
When in doubt, serialise; a slower run is cheap, a corrupted rate-limit
budget or a doubled real order is not.

**The orchestrator hands out `shape.needs` centrally, before dispatch, rather
than letting the engagement's own subagent go find it.** A provisioned test
journal, an address whose mail is readable, SSH read access, the remaining
rate-limit allowance for this IP — these are shared resources, and the whole
point of a per-IP limit is that concurrent agents cannot each assume the
whole of it. Read `shape.needs` from the brief, get each one ready (or
confirm it already is), and hand the ready resource to the engagement's
subagent along with `shape.mustNot` stated in words.

**Its completion condition is a report and its captures, not a merge.** The
subagent runs the engagement to whatever conclusion its ticket's Work section
describes, files every `backlog/` capture it finds the way `manage-tasks`
always requires, and writes a report the way `test-the-live-site` or
`test-with-personas` already would for the same kind of finding. When it is
done, move the ticket to `testing/` with the report's path in the move
commit message — not to `completed/`; a person still decides whether an
engagement's findings are actually acted on, same gate as every other ticket
here.

**Sometimes the finding is that nothing is left to build, and the remaining
step is a person's.** B1147 is the recorded case: the credential fault the
ticket was chasing had stopped reproducing, and driving the flow further
found a different refusal — Gelato's own portal demanding company
information nobody but the account owner can enter. There was no code to
write and no further engagement to run. Where this happens, say so exactly
that plainly in the report — name what the remaining step is and whose it
is — rather than parking the ticket as though a build had failed, or leaving
it looking unfinished.

**B911 is the shape of an engagement that did finish**, for contrast: it drove
the live print flow for real, spent real credits, placed real physical
orders, and produced four findings and a rewritten `docs/providers/photobook.md`
rather than a diff. Nothing about it fits Step 2's pipeline — there was never
a worktree to merge — and everything about it fits this section.

## Step 3 — merges, serialised, in the main checkout

As each group subagent reports its worktree ready (every ticket in it either
merged-in-worktree-ready or parked), merge **one group at a time**, from the
main checkout, in the order groups finish — never in parallel, even though the
builds were:

```bash
cd /Users/severin/Documents/GitHub/fernscout
git rev-parse --abbrev-ref HEAD     # must say "main"
git status --short                  # must be clean of anything but task files
git merge --no-ff <group-name>
npm run unused
```

A red `npm run unused` after a merge **stops that merge** — it does not carry
forward into the next one. `git reset --hard` the merge commit is the group's
regression against a codebase it never saw while it was being built (this is
the exact shape B880/B881/B883/B896 recorded, one clean group breaking a
sibling's caller); go find what the merge broke, in the main checkout, before
merging the next group. This is why merges are serialised even though builds
are not — the whole reason to run this step by hand rather than in a subagent.

```bash
npm run tasks -- move <id> testing   # every non-parked ticket in the group
git add -A && git commit -m "<id>, <id>: merged, awaiting review"
git worktree remove .claude/worktrees/<group-name>
git branch -d <group-name>
```

## Waves, and the deploy in between

A **wave** is every group merged since the last deploy. Once every group
scheduled for this wave has merged (or hit its slot limit and the next wave
starts), deploy:

```
vps                                    # this instance's one-command deploy
curl -s https://<domain>/api/health | jq
```

`/api/health` must go green before this wave counts as shipped. If it does
not — the deploy skill's own retry logic already tried and failed — **park
every non-dropped ticket in this wave**, the same as a verify failure, with
the health output as evidence, and stop scheduling further waves. Do not
retry the deploy a second time inside this run; a failed deploy is exactly
the kind of thing a person needs to see, not a thing to retry into silence.

Then **validate the wave against the live instance, and write down a verdict
per ticket.** This is the step that makes "deployed" mean something, and it is
the one most easily faked: a capture written to disk that nobody compares
proves only that a page still returns bytes. B1090 is the recorded version of
that mistake one level down — a feature checked against the two rows the same
change had edited, inert everywhere else, green the whole way.

So every live ticket in the wave gets exactly one of three verdicts, written
to `.claude/runs/<run-id>/<id>/live.json` as `{"verdict": …, "evidence": …}`:

- **`shows`** — the ticket changes something a person sees. Capture the
  deployed page beside the `before` `plan-a-run` already took, then **look at
  both** and say what differs:

  ```bash
  node .claude/skills/test-in-a-browser/check-page.mjs <url> \
    .claude/runs/<run-id>/<id> --widths 1280,390 --slug after
  # writes after-1280.png, after-390.png and after.json beside the before-*
  # files. `--slug` is what makes those names; without it the script names
  # each capture after the URL and report-a-run finds neither half.
  ```

  Read the two images. The evidence is a sentence naming the visible
  difference — *"the budget panel now renders on a journal with no features
  block"* — not "captured" and not a file path. If `plan-a-run` recorded no
  before-state, there is nothing to compare and this is not the right verdict.

- **`answers`** — the ticket changes behaviour with no visible face, which is
  most backend work. Name a request against the deployed instance whose
  response proves the change, run it, and paste the actual response:
  `/api/health` for a capability or a limit, a documented `/api/v1` call for a
  route, a refusal for a gate that should now refuse. A test passing in CI is
  not this: CI ran against a checkout, and this step is about the machine
  serving the site.

- **`cannot`** — nothing observable from outside without a credential or a
  side effect this run must not produce: an owner's cookie session, a real
  postal address, a message to somebody's phone, money moving. Say which, in
  one sentence. **This is a legitimate verdict and must not be avoided by
  inventing a weaker check** — but a run where most tickets land here is a run
  whose acceptance lines were written against things nobody can see, and that
  is worth saying in the report.

**A live check that contradicts the ticket's Acceptance parks the ticket.** It
does not go to `testing/` looking finished. Merged and deployed and wrong is
the worst of the three states, because it is the one a person stops looking
at: the lane says somebody already decided it works.

The run is **not finished** while any wave is undeployed, or any live ticket
in a deployed wave has no verdict. Steps 3 and 4 do not begin until this one
has an answer for every ticket in the wave.

Deploying per wave rather than once at the end is deliberate, not
incidental — see the numbers above: it is the bottleneck this skill exists
to reinsert, so six hours of unattended building do not compound into one
unreadable failure at the very end. A batch small enough to fit in one group
is one wave; most batches are several.

**Two things about the lane moves will bite once each, and both did on
2026-09-09.**

A task file is stamped in the frontmatter by every lane move, so a ticket
moved on `main` *and* moved on the branch conflicts on `started:`, `session:`
and `claimed:` — three lines, same session id, seconds apart. Keep `main`'s
stamps and carry on; the branch's are the same fact recorded a moment later.
Better still, move the lane on `main` before the branch is cut and never move
it inside the worktree.

And **read what the move printed.** `npm run tasks -- move` takes one id, and
a shell loop that feeds it several while swallowing the output will happily
move one of them and say nothing about the other three. Four tickets were
dispatched to worktrees that day while three of them still sat in `open/`.
One call per id, and check for the `→` line.

## Step 4 — end with the report

When every group has either merged-and-deployed-and-verdicted or parked, and
every engagement has either reported or parked, hand the whole run directory
to `report-a-run` — every merged ticket **with its `live.json` verdict and
that verdict's evidence**, every parked one with its evidence, every dropped
ticket from the brief, every engagement with its findings and captures, and
the questions parked mid-run (there should be none if `plan-a-run` did its
job; if there are any, that is worth a sentence of its own). Do not write the
report yourself outside that skill — same palette, same machinery, reused
rather than restated.

The report is what a person tests from, so the `shows` tickets have to reach
it as **a live URL each, and the before-and-after pair** — a person verifying
a batch should not have to work out which page a ticket landed on. A ticket
whose verdict is `cannot` needs the opposite: say plainly that nothing was
checked live and what it would take, so it is obvious which rows still rest on
a test alone.

## Not doing

- **No promotion.** `plan-a-run`'s artifact was the review gate and the
  person's answer to it was the promotion into this run — nothing here moves
  a ticket into `open/`, because nothing here is a person deciding to start
  work.
- **No `completed/`.** A merged, deployed, live-checked ticket still stops at
  `testing/` — a person looking at it is the gate this skill cannot stand in
  for, same as `work-on-a-task`.
- **No new lane.** A parked ticket stays exactly where `work-on-a-task` would
  have left an unfinished one: `in-development/`, held, with the reason
  written down.
- **No merge for an engagement.** A finished OPS ticket moves straight from
  `in-development/` to `testing/` with its report's path — there was never a
  worktree, so there is nothing to merge.
- **Changing what an OPS ticket is, or how `test-the-live-site` runs one by
  hand.** This skill only schedules an engagement `plan-a-run` already
  described; it does not redefine the type.

## Red flags — stop

- Asking the person anything once step 1 has finished reading the brief.
- Recomputing the grouping instead of reading `groups[]` from the brief.
- More than 3 groups building at once.
- A fourth `npm run verify` attempt on a ticket instead of parking it at
  three.
- Merging two groups without an `npm run unused` between them.
- Carrying a red `npm run unused` forward "to fix at the end".
- Deploying once at the end of the whole run instead of once per wave.
- A group's own subagent merging its branch itself, instead of handing a
  ready worktree back for the serialised merge.
- Moving a parked ticket to `testing/` because most of the batch passed.
- Taking an `after` capture and never opening it, or writing a `shows`
  verdict whose evidence is a file path rather than the difference seen.
- Giving a backend ticket no live verdict because it has no page — that is
  what `answers` is for, and `/api/health` answers most of them.
- Reaching `report-a-run` with a wave deployed and unverdicted, or with a
  ticket in `testing/` whose live check contradicted its Acceptance.
- Promoting anything to `open/` or `completed/`.
- Handing the implementer a summary of the chosen option instead of the
  brief's actual mockup HTML, or verifying against the ticket alone without
  the brief's chosen option in hand.
- Putting an `OPS` ticket in a build group, or giving it a worktree.
- Two engagements dispatched at once, or a `live` engagement dispatched
  alongside a `live` build wave.
- Letting an engagement's own subagent go find `shape.needs` itself instead
  of the orchestrator handing out the shared resource centrally.
- Reporting an engagement that found no remaining code to write as parked,
  instead of saying plainly that the remaining step is a person's and what
  it is.
