---
id: B226
title: Two new deploy-time checks run only where a binary happens to exist, and CI may have neither
type: CHORE
priority: low
complexity: low
area: tests, ci, deploy
found: "2026-09-04T07:40:57Z"
started: "2026-09-07T11:06:11Z"
merged: "2026-09-07T11:21:26Z"
completed: "2026-09-07T13:07:14Z"
---

# B226 — Two new deploy-time checks run only where a binary happens to exist, and CI may have neither

## Why

G11 added two checks, and both are guarded by "if the binary is here":

- `test/systemd-units.test.ts` runs `systemd-analyze verify` over
  `deploy/*.service` and `deploy/*.timer` under `test.skipIf(!HAS_ANALYZE)`.
  It is the authority on the B203 defect — a directive in the wrong section —
  and it cannot run on macOS, where these files are edited. It is *believed*
  to run on `ubuntu-latest`, and that has not been confirmed.
- `test/check-caddy.test.ts`'s keeper, which re-adapts the fixture Caddyfiles
  and requires the committed `caddy adapt` output to match, is
  `test.skipIf(!HAS_CADDY)`. CI installs no Caddy, so it runs on a maintainer's
  laptop and nowhere else — which is precisely the shape B180 and B195 were
  filed about, one lane over.

Neither hole is dangerous today: the always-running half of each file (the
directive→section table; the comparator over committed JSON) is the substantive
check, and the skipped half is its keeper. But a keeper that runs on one
machine is a keeper nobody is watching, and committed adapter output is exactly
the kind of copy that rots quietly.

## Work

- Confirm whether `systemd-analyze` is present on `ubuntu-latest`. If it is,
  say so in the test and in `.github/workflows/ci.yml` so the next person does
  not have to wonder; if it is not, install `systemd` in the `test` job or
  move the verify into a small job of its own.
- Install Caddy in one CI job — it is a single static binary, the
  `backup-drill` job already downloads restic the same way — so the fixture
  keeper runs somewhere other than one laptop.
- Consider whether either should be asserted rather than skipped in CI, the
  way `backup-drill` asserts its three preconditions instead of hoping (B181).

**Not doing:** removing either skip on a developer machine. Neither binary can
be required of a laptop.

## Acceptance

- A CI run shows `systemd itself finds no unknown key in any of them` executing
  rather than skipping — or the ticket records that it cannot and why.
- A CI run shows `regenerates the fixtures, and they do not change` executing.
- A deliberately stale `test/fixtures/caddy/expected.json` fails CI.

## Related

Found while building B203 and B66. Same class as B180, B181 and B195: a test
that never runs the thing it claims to test.

## Work done

**Chose: install the binaries in CI**, for both checks — not the loud-skip
fallback — because both are single, cheaply-verifiable installs and this is
exactly the shape `backup-drill`'s restic install already established as this
project's pattern for "the keeper needs a real binary CI does not ship".

- **`systemd-analyze`**: `ubuntu-latest` is GitHub's real Ubuntu VM image, not
  a container — it boots with systemd as PID 1 — so the `systemd` package
  (and `systemd-analyze` with it) ships in the base image already; nothing to
  install. Rather than trust that silently (which is the exact failure mode
  this ticket is about), the `test` job now has a step that runs
  `systemd-analyze --version` and fails the whole job if it is missing, so a
  future runner-image change that ever drops it is caught loudly instead of
  the keeper quietly going back to skipping. I could not run an actual
  `ubuntu-latest` job to confirm this from here (no GitHub Actions runner in
  this environment) — the assertion step is what makes that unnecessary going
  forward: CI will say so on the first run either way.
- **Caddy**: installed as a single static binary in the `test` job, before
  `npx vitest run`, the same way `backup-drill` installs restic — downloaded
  from the pinned GitHub release (`v2.11.4`), verified against the sha512 from
  that release's own `_checksums.txt` (Caddy publishes sha512, not sha256).
  Added as `.github/workflows/ci.yml`'s `test` job steps, so both matrix legs
  (sqlite, postgres) run `test/check-caddy.test.ts`'s fixture keeper — the
  redundancy is harmless; the install is a few seconds.

Verified locally: ran the same curl+sha512sum+install shell logic outside CI
against the pinned release and confirmed the checksum matches (the checksum
in the workflow was read directly from the release's own checksums file, not
computed once and trusted). Did not have a Linux CI runner to execute the
actual GitHub Actions job, so "a CI run shows X executing" per the acceptance
line will only be confirmed once this merges and CI runs — this is CI
configuration, so a local `npm run verify` cannot exercise the `test` job's
new steps at all; the workflow YAML was validated for syntax with `js-yaml`.

Not done: a deliberately-stale `test/fixtures/caddy/expected.json` fails CI
(the acceptance's third line) is unchanged from before this ticket — that
already fails locally whenever Caddy is installed and was not itself part of
what was silently skipping; only the *running it at all in CI* half was
missing, which the Caddy install above now supplies.
