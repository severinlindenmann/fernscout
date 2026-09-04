---
id: B131
title: A merge to main does not reach fernscout.ch until somebody runs deploy.sh by hand
type: FEATURE
priority: medium
complexity: low
area: deploy, ci
found: "2026-09-03"
related: B132
---

# B131 — A merge to main does not reach fernscout.ch until somebody runs deploy.sh by hand

## Why

`.github/workflows/ci.yml` runs lint, typecheck, tests on both dialects, and a
build on every push to `main` — and then stops. Shipping is a separate manual
act: SSH to the VPS and `sudo ./scripts/deploy.sh` (the `deploy` skill).

The gap costs two things. Work merged and verified sits unshipped for however
long it takes somebody to remember, so `testing/` tasks wait on a human step
that has nothing left to decide. And a manual deploy is where the interesting
mistakes live: deploying an unpushed branch, deploying while CI is red,
forgetting the restart. `/api/health` reports `commit` from `GIT_SHA`
(`app/api/health/route.ts:94`, written by `scripts/deploy.sh:79-85`), so the
drift between `main` and what is serving is already observable — nothing acts
on it.

`scripts/deploy.sh` is already the right shape for this: it is idempotent,
builds before restarting so a failed build leaves the running site untouched,
and exits non-zero if health does not come back within 30s. What is missing is
only the trigger.

Related to B132, which is the same pull-build-restart for somebody else's
server; this task is only fernscout.ch, the instance whose deploy key we hold.

## Related

The same pull-build-restart with different triggers and different threat
models: B131 pushes to the machine whose deploy key we hold, B132 has
somebody else's instance reach out to GitHub on its own. Related,
deliberately not one task — and B253 is the first observation of what B131
costs.

## Work

Add a `deploy` job to `.github/workflows/ci.yml`, gated on `needs: [build]`
and `github.ref == 'refs/heads/main'`, that reaches the VPS and runs the
existing `scripts/deploy.sh`. Deliberately not rewriting the script — the
deploy stays a pull-install-build-restart on the serving machine, and this
task adds nothing to it beyond being invoked.

Decide and record the reach-in mechanism, because it is the whole security
surface of this change:

- **SSH from Actions** with a deploy key in repo secrets, `deploy.sh` behind a
  single-command `authorized_keys` entry so the key cannot open a shell; or
- **a pull-side poller** on the VPS (systemd timer) that compares
  `git ls-remote origin main` against `git rev-parse HEAD` and runs the script
  when they differ — no inbound credential at all, at the cost of latency.
  This is also the shape B132 needs, so building it here may pay for both.

The second wants a check that CI was green for that sha before deploying it,
or the timer ships a commit the tests have not finished judging.

Concurrency: a `concurrency: deploy-production` group with
`cancel-in-progress: false`, so two merges in quick succession queue rather
than run `deploy.sh` twice against the same checkout.

Not in scope: rollback, blue/green, or an image. Decision in `scripts/deploy.sh`
stands — there is no artifact to ship, so a rollback is `git checkout <sha> &&
deploy.sh` and needs no machinery.

## Acceptance

- A merge to `main` results, with no human step, in `/api/health` on
  fernscout.ch reporting `commit` equal to that merge's sha.
- A red CI run does not deploy. Verifiable by pushing a branch with a failing
  test to a fork, or by inspecting the job's `needs:` and ref guard.
- A failing `npm run build` on the VPS leaves the previous version serving —
  `/api/health` still answers, `commit` unchanged — and the workflow run is
  red.
- Whichever mechanism is chosen is written down in the `deploy` skill, so the
  manual path and the automatic one do not describe different deployments.
