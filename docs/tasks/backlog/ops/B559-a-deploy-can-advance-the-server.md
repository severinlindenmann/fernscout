---
id: B559
title: A deploy can advance the server's checkout without rebuilding, and then report nothing to do
type: OPS
priority: high
complexity: low
area: deploy, ops
found: "2026-09-06T09:40:41Z"
---

# B559 — A deploy can advance the server's checkout without rebuilding, and then report nothing to do

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

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
