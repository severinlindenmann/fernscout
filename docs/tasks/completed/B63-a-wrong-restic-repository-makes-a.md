---
id: B63
title: A wrong RESTIC_REPOSITORY makes a new empty repo instead of failing
type: ISSUE
priority: medium
complexity: low
area: backup, ops
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-03"
completed: "2026-09-03"
---

# B63 — A wrong RESTIC_REPOSITORY makes a new empty repo instead of failing

## Why

`scripts/backup.sh:94–97` is a convenience that removes a failure mode from the
first run and adds a worse one to every run after it:

```bash
if ! restic snapshots >/dev/null 2>&1; then
  log "repository not initialised yet — running 'restic init'"
  restic init
fi
```

"Not initialised yet" and "not the repository you meant" are indistinguishable
from inside that `if`. Verified locally while writing `test/backup-script.test.ts`
for B21: with `RESTIC_REPOSITORY` pointing at a path that does not exist,
`restic init` **creates it**, `restic backup` pushes into it, `restic forget`
prunes it, and the script exits `0`. The journal says "repository not
initialised yet" — one line, at 03:20, in a run that otherwise looks like every
other successful night.

Every earlier snapshot is still in the old repository and still safe. What is
gone is anyone *knowing* that, and the retention policy now applies to a
fresh repository with one snapshot in it. A typo in `/etc/fernscout/env`, or an
`EnvironmentFile` that failed to load a variable, is enough.

On S3 the same shape holds for a wrong prefix in a bucket the credentials can
write to, which is the likely typo. A wrong *bucket* would probably fail on
permissions, which is luck rather than design.

Related: B64 (nobody is told when a backup fails). This is the inverse — the
backup does not fail, and that is the problem.

### The other half, hit for real on 2026-09-01

The Why above describes one shape. The restore drill (B21) hit the *other* one
the same night, on the live server, and it is the one that actually bites first:

> The repository must be **owned by the service user**. Root-owned, the
> script's `restic snapshots` probe fails on permissions, the script reads that
> as "not initialised yet", runs `restic init`, and dies on `config file
> already exists`.

So there are two failure shapes behind the same `if`, and a fix that handles
only one leaves the other:

| | what is true | what the old probe did | what it should do |
| --- | --- | --- | --- |
| **absent** | nothing is there | `restic init` — silently correct on a first run, catastrophic on a typo | refuse; create only when explicitly asked |
| **unreachable** | something is there, or might be, and we cannot see it: permissions, wrong password, network | `restic init` — collides with the config that was there all along | refuse, loudly, and say it is not absence |

Measured with restic 0.19.1 while building this, and the reason the fix is not
guesswork:

| case | `restic cat config` exit | message |
| --- | --- | --- |
| path missing / empty directory | **10** | `repository does not exist: … no such file or directory` |
| readable repository | 0 | — |
| wrong `RESTIC_PASSWORD` | **12** | `wrong password or no key found` |
| repository unreadable (mode 000) | 1 | `unable to open config file: … permission denied` |
| repository under an unreadable parent | 1 | same |

Note the shape of the trap in the last two: the permission message *contains*
`unable to open config file`, which is also in the absent message. A fallback
that matched that phrase would send a repository that exists down the "create
one" path — which is the original bug, reintroduced.

## Work

Decide whether auto-init is worth keeping at all; a `restic init` run by hand
once, at deploy time, is a small price. If it stays, distinguish the two cases:

- `restic cat config` (or `restic snapshots` with the error text kept) tells
  "repository absent" apart from "cannot reach it" / "wrong password". Only
  absent may auto-init.
- Gate auto-init behind an explicit `BACKUP_INIT_IF_MISSING=1`, off by default,
  so the nightly timer never creates a repository.
- Either way, log loudly and distinctly when a repository is created, and count
  the snapshots afterwards: a "successful" backup that leaves exactly one
  snapshot in a repository the operator believes has fourteen deserves a
  `WARNING` in the journal.

## What was built

`restic snapshots` replaced by `restic cat config` — the question actually
being asked — classified into three states, and the classification is the fix:

- **Exit status first.** Since restic 0.17, `10` is "repository does not exist"
  and `12` is "wrong password". Structural, not textual.
- **Message second, for older restic.** Debian 12 ships 0.14, which returns `1`
  for everything, so a stock `apt install restic` gets no exit codes to read.
  The fallback checks the *cannot see it* wordings **first** — permission,
  password, refused, timeout, DNS, S3 auth — then the *absent* wordings, and
  anything it does not recognise is treated as `unreachable`. It fails towards
  the state that refuses to create anything, because absence has to be proven.
- **`absent` no longer initialises by default.** `BACKUP_INIT_IF_MISSING=1`
  turns it back on for one run; the nightly timer never has it. The refusal
  message names both possibilities and gives the `restic init` line.
- **`unreachable` never initialises at all**, at any setting, and says in as
  many words that this is not "no repository yet" but "no answer" — with the
  ownership cause listed first, since that is the one the drill hit.
- **A count after every run.** The probe cannot catch a path that holds a
  *different* readable repository — an old one, a neighbouring bucket prefix —
  which reads as `present` and backs up perfectly into the wrong place. Each
  run logs how many snapshots the repository holds and warns when that is one.

The first-run path is documented in three places now: `docs/archiv/runbook.md`
§Backups (a `restic init` step, before the first timer run), `.env.example`, and
`scripts/backup.sh`'s own header.

Two things beyond the task, both small and both in the same block: the
`.env.example` backup section had no entry for B64's `BACKUP_ALERT_EMAIL` or
`BACKUP_MAX_AGE_HOURS` either, so all three are documented together.

**Captured, not absorbed:** B115 — an unreachable repository still takes the
unit's whole `TimeoutStartSec=30min` to give up, because restic retries with no
overall deadline (measured: still retrying after 3 minutes against a refused
port). B63 makes the *diagnosis* correct; it does not make it fast. Bounding it
wants `timeout(1)`, which is not on macOS by default, so it was left rather
than written untested in a backup script.

## Acceptance

- A run against a `RESTIC_REPOSITORY` that does not exist does not silently
  become a successful backup into a new repository.
- The existing first-run path is still documented and still works, by whatever
  route is chosen.
- Covered in `test/backup-script.test.ts`, which already has a local filesystem
  repository to point at a wrong path.

### Evidence

All in `test/backup-script.test.ts`, against the real script and a real local
restic repository.

- **A wrong path is not a successful backup.** "a RESTIC_REPOSITORY that does
  not exist is refused, not quietly created": the run exits non-zero, the
  journal says "there is no repository at" and "refusing to create one",
  "backing up to" never appears, **nothing exists at the wrong path
  afterwards**, and the real repository's snapshot count is unchanged. Before
  this change the same test would have found a new repository with one snapshot
  in it and exit 0.
- **The first-run path still works, and is still documented.** "the first run
  still works, by the route the runbook documents": one run with
  `BACKUP_INIT_IF_MISSING=1` creates the repository, exits 0, and logs both the
  `NEW, EMPTY` warning and the one-snapshot warning. The suite's own fixture
  repository is now created by an explicit `restic init` in `beforeAll` — the
  same command the runbook now tells an operator to run, so the documented
  route is exercised on every test run rather than described.
- **Both failure shapes, separately.** "a repository that cannot be read is
  never mistaken for one that is not there" copies the real repository, makes it
  mode 000 — the drill's exact case — and asserts the run says "cannot read the
  repository", never "there is no repository at", never creates anything and
  never pushes. "a wrong password is not mistaken for an absent repository
  either" does the same for exit 12. "an older restic, which returns 1 for
  everything, is classified by its message" stubs `restic` on PATH with the
  0.14-era wordings and covers all three: absent, permission denied, and an
  unrecognised error defaulting to `unreachable`.
- **The count is not a false alarm.** "a healthy repository with a history draws
  no low-count warning" asserts the warning is absent once there is more than
  one snapshot.

## Verification

The agent that built this hit a session limit before verifying it. The code was
already merged; what follows was run afterwards against `scripts/backup.sh` on
main, by hand, and is why the task moved to `testing/` rather than being left
in `in-development/` looking half-finished.

Four checks: `tsc` clean, `eslint` 0 errors / 4 warnings (the standing four),
`vitest` 1656 passed + 1 skipped across 100 files, `npm run build` exit 0.
`test/backup-script.test.ts` on its own: 16 passed, 1 skipped.

Behaviour, driven against the real script with a temporary `DATA_DIR`,
`CONTENT_DIR` and filesystem repository:

| case | result |
| --- | --- |
| absent repo, no opt-in | refuses, names the typo risk, **creates nothing**, exit 1 |
| absent repo, `BACKUP_INIT_IF_MISSING=1` | creates it, backs up, exit 0 — and warns that one snapshot is *also* what a wrong path looks like |
| unreadable repo (mode 000), **with** the opt-in | `cannot read the repository … (restic exit 1)`, creates nothing, exit 1 |
| wrong password, with the opt-in | `cannot read … (restic exit 12)`, creates nothing, exit 1 |
| healthy repo | exit 0 |

The two failure shapes are distinguished as intended: the permission and
password cases both report *cannot read*, never *no repository*, so the
original bug cannot be reintroduced by a fallback matching the shared
"unable to open config file" wording. Every failing case exits non-zero, which
is what makes B64's alerting fire and what systemd records.

The unreadable-with-opt-in case is the one the restore drill hit on the live
server on 2026-09-01, where the old probe read permission-denied as absence and
died in `restic init`.
