---
id: B132
title: A self-hosted instance has no way to learn a new release exists, let alone install it
type: FEATURE
priority: medium
complexity: medium
area: deploy, capabilities, self-hosting
found: "2026-09-03"
related: B131
---

# B132 — A self-hosted instance has no way to learn a new release exists, let alone install it

## Why

Fernscout is meant to be self-hosted: `content/config.json` names the
repository, and `scripts/deploy.sh` deliberately has no image and no artifact —
"a deploy is a pull, an install, a build and a restart". That is a good story
for the person who wrote it and a poor one for the person who installed it once
in March and has not thought about it since. Their instance stays on whatever
commit it was installed at, including through security fixes, and nothing
anywhere tells them.

There is no version signal either. `/api/health` reports `commit` from
`GIT_SHA` (`app/api/health/route.ts:94`), which is a sha with nothing to
compare it against — the instance does not know what upstream's `main` is, so
"you are 40 commits behind" is not a sentence anything can currently say.

The cost is the ordinary one for self-hosted software: instances drift onto old
code, a fix we shipped never reaches the people it was for, and the only
remedy is a README paragraph asking somebody to remember.

This is the same pull-build-restart as B131 with a different trigger and a
different threat model: B131 pushes to a machine whose key we hold, this one
runs on somebody else's machine and reaches out to GitHub on its own.

## Related

The same pull-build-restart with different triggers and different threat
models: B131 pushes to the machine whose deploy key we hold, B132 has
somebody else's instance reach out to GitHub on its own. Related,
deliberately not one task — and B253 is the first observation of what B131
costs.

## Work

Two halves, and the first is worth having even without the second.

**Knowing.** Teach the instance to compare itself against upstream — the
release tag or `main` on the repository named in `content/config.json` — and
surface the answer in `/api/health` and somewhere the owner actually looks. The
check is a `git ls-remote` or an unauthenticated GitHub API call, cached, and
it must fail *soft*: no network, a rate-limited API or a renamed repository
makes the field unknown, never makes the instance unhealthy (compare B115,
where an unreachable backend burned the run).

**Updating.** A script — `scripts/self-update.sh` or a mode of the existing
`deploy.sh` — that an operator can run themselves or put behind a systemd
timer, and an `auto_update` switch in the `features` block of
`content/config.json` that turns the timer on. Off by default, like every other
capability (`lib/capabilities.ts`, `FEATURE_NAMES` in `lib/config.ts`), and
absent-not-broken when off.

The parts that need deciding rather than assuming, and which are the reason
this is not low complexity:

- **What it tracks.** Tagged releases, not every merge to `main`. An instance
  that follows `main` installs whatever landed twenty minutes ago; that is the
  right default for fernscout.ch (B131) and the wrong one for a stranger's
  journal. This likely means the project starts cutting tags.
- **What it trusts.** Pulling and executing code from the internet on a timer
  is the security surface here, and it should be written down rather than
  implied: pin to the configured remote, verify it is the expected repository,
  consider requiring signed tags, and never let anything in `content/` decide
  which remote to pull from if a non-owner can write `content/`.
- **What it must not touch.** `content/<username>/` is the person's journal.
  An update pulls code and runs `scripts/sync-shipped-content.sh` (which
  already refuses to write outside `locales/` and `rates/` — B56); it never
  touches `config.json` or a journal.
- **Migrations and failure.** `npm run db:migrate` runs before the build, as
  in `deploy.sh`. A failed build must leave the old version serving, and the
  failure must be *reported* — an update that silently stops updating is the
  same failure as never having one. A log line the owner never reads is not a
  report; say where this lands.
- **Local changes.** `git pull --ff-only` fails on a self-hoster who edited a
  file. Detect a dirty tree and refuse with an explanation rather than
  stashing somebody's change.

Not in scope: an in-app "update now" button, or updating across a config
schema bump without the operator seeing it. `configVersion` exists; a version
jump should stop and say so.

## Acceptance

- `/api/health` reports both the running commit and whether a newer upstream
  release exists, and answers normally (with that field unknown) when GitHub is
  unreachable — verifiable by pointing the check at an unroutable host.
- With `auto_update` absent from `content/config.json`, nothing schedules,
  nothing calls out, and `/api/health` explains the capability is off.
- With it enabled on a test instance pinned to an older tag, the timer brings
  it to the current release and `/api/health` reports the new sha.
- A deliberately broken build upstream leaves the instance serving the previous
  version, and the failure is visible to the operator without reading
  `journalctl`.
- A dirty working tree refuses the update with a message naming the modified
  files, and changes nothing.
- No file under `content/<username>/` is modified by an update. A test asserts
  it.
