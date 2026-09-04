---
id: B226
title: Two new deploy-time checks run only where a binary happens to exist, and CI may have neither
type: CHORE
priority: low
complexity: low
area: tests, ci, deploy
found: "2026-09-04T07:40:57Z"
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
