---
id: B559
title: A deploy can advance the server's checkout without rebuilding, and then report nothing to do
type: OPS
priority: high
complexity: low
area: deploy, ops
found: "2026-09-06T09:40:41Z"
started: "2026-09-07T11:05:57Z"
merged: "2026-09-07T11:23:37Z"
---

# B559 — A deploy can advance the server's checkout without rebuilding, and then report nothing to do

## Why

Shipping B547-B551 — a rewrite of the photobook composer, entirely in
`app/[user]/(trip)/photobook/` and `lib/photobook/` — the deploy said:

```
==> already at c415c2cb49a1, and it was healthy
==> nothing to do — nothing that reaches the running site changed
    build     skipped — nothing the build reads changed
    restart   skipped — the running build is still the right one
```

It was wrong. `/api/health` reported the running build as `ce911462`, which does
not contain the merge — checked with `git merge-base --is-ancestor`. The site
was serving the old composer, and the deploy reported success.

The mechanism: **the server's git checkout and the built artefact are two
separate positions, and the skip logic compares against the checkout.** An
earlier run had already pulled `c415c2` while deciding it had nothing to build,
so the next run diffed `c415c2` against `c415c2`, found nothing, and skipped
again. Once the checkout runs ahead of the build, every subsequent deploy is a
no-op and each one says the site is healthy — which it is, on the wrong code.

`ship.sh` does print `(not HEAD — the old build is still what serves)` next to
the health commit, and that line is what gave it away. It is a footnote on a run
that otherwise says `done`, and it was nearly missed. `--full` rebuilt and fixed
it.

The danger is not this deploy — it is the shape. A deploy that skips work is a
good optimisation; a deploy that skips work *and cannot tell it is behind* means
every future deploy of any change is a coin toss, and the failure is silent and
sticky rather than loud and one-off.

## Work

Compare against **what is built**, not what is checked out. `/api/health`
already reports the built commit and `ship.sh` already reads it — that is the
number the skip logic should diff from.

Then make the disagreement loud rather than a footnote: if the built commit is
not the checkout's commit at the end of a run, that is a failed deploy, not a
note. Exit non-zero.

Consider whether the checkout should advance at all before the build that will
use it succeeds — the current order is what allows the two to separate.

`.claude/skills/vps/ship.sh` is gitignored (it knows this instance's host and
domain), so the fix does not land in the repository. Record what changed in this
ticket so the next instance's script can be written correctly.

## Acceptance

- A deploy whose built commit ends up behind the checkout exits non-zero.
- Deploying a change under `app/` or `lib/` after a run that skipped the build
  rebuilds rather than skipping again.
- Reproduce first: advance the checkout without building, then deploy a change
  under `lib/` and watch it skip.

## Done

The log lines quoted in the Why section — `already at …, and it was
healthy`, `nothing to do — nothing that reaches the running site changed`,
`build skipped — nothing the build reads changed`, `restart skipped — the
running build is still the right one` — are `scripts/deploy.sh`'s own
verbatim log output (`log()`/`skip()` at lines 28-29, and the exact strings
at lines ~112, 187, 208, 274 before this change). `ship.sh` is a thin,
instance-specific wrapper that runs this script on the server and adds the
`(not HEAD — …)` footnote and `--full` retry on top — it is not a second,
independent implementation. So the fix belongs in, and now lives in,
`scripts/deploy.sh`, which **is** in the repository; `ship.sh`'s own
wrapper needs no change for this ticket, since it inherits the fix the
moment it invokes the updated script.

Changed, in `scripts/deploy.sh`:

- **The skip logic's baseline is now what `/api/health` says is actually
  running, asked live, not `$STATE_FILE`** (new `served_commit()`, used to
  set `DEPLOYED` around what was line 166). `$STATE_FILE` used to record
  `$HEAD_SHA` on every healthy check regardless of whether a build or
  restart actually happened — so a run that (for whatever reason) wrongly
  decided nothing needed building still advanced the baseline the *next*
  run diffs from, and the missed change dropped out of every future `git
  diff` for good. Asking the live service instead means the diff always
  spans from the commit that is truly serving, however many skip-runs
  happened in between, so a change that was missed once is not missed
  again. `$STATE_FILE` is now only the bootstrap for a service that has
  never answered `/api/health` at all (a fresh machine).
- **The disagreement is now loud, not a footnote.** After a run restarts the
  service because it decided `$HEAD_SHA` needed to go live, the final health
  check now compares the `commit` `/api/health` reports against `$HEAD_SHA`;
  a mismatch prints a named `ERROR:` line and exits non-zero (new code just
  before `record_deployed` in the health-poll loop). A run that correctly
  decided **not** to restart is not checked against `$HEAD_SHA` — that
  divergence is by design (the whole point of the skip optimisation) and
  asserting equality there would turn every legitimate skip into a false
  failure, which the ticket explicitly warns against.
- Did **not** reorder the pull ahead of the build (the "consider whether the
  checkout should advance at all" idea in Work) — `classify()` needs the old
  and new commits to diff, so pulling first is structural to how the script
  decides what to build, and the live-health baseline above closes the
  actual hole (a wrongly-skipped build being permanently forgotten) without
  that larger restructuring.

Not testable with the existing shell-script harness: `test/deploy-plan.test.ts`
only exercises `--plan`, which classifies paths and never reaches the health
loop, `$STATE_FILE`, or a running service — so it needed no changes and still
passes. Reproducing the failure end-to-end needs a running `fernscout`
service and `/api/health`, which this worktree does not have; the fix was
verified by reading the changed script against the exact log lines and
mechanism the Why section names, and `bash -n scripts/deploy.sh` for syntax.

`.claude/skills/vps/ship.sh` is gitignored and untouched by this session, as
expected — it needed no change since the mechanism it delegates to is what
was fixed.

**Nothing further to do on the server for this ticket** — the fix lands via
the next ordinary deploy of this repository, which is `ship.sh` calling the
now-fixed `scripts/deploy.sh` on the VPS as it always has. No manual step,
no live verification was performed by this session.
