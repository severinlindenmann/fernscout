---
id: B662
title: Plaintext sign-in codes still reach the backup through content/.mail
type: SECURITY
priority: medium
complexity: low
area: backup, mail, content root
found: "2026-09-07T06:47:12Z"
---

# B662 — Plaintext sign-in codes still reach the backup through content/.mail

## Why

Found during B656's restore drill, in the restored tree itself:

```
dr/content/.mail/2026-09-05T17-37-41-075Z-agent-fernscout-ch-dein-code-fur-fernscout.eml
dr/content/.mail/2026-09-05T20-54-07-404Z-lindenmann-severin-io-your-code-to-start-a-journal-on-fernscout.eml
```

B636 moved sent mail out of `content/` and into `<dataDir>/mail/`, precisely so
that plaintext sign-in codes stop travelling in backups and exports. B653's
allowlist then excludes `<dataDir>/mail/` by simply not naming it.

Neither covers `content/.mail/` — mail addressed to somebody who owns no
journal yet, which is signup codes. It is *inside* `content/`, and `content/`
is in the allowlist wholesale, so those files are in every snapshot.

The two above are pre-B636 leftovers and B636's legacy sweep will remove them
within two days of the instance's next send. That is what makes this small
rather than urgent. What makes it real is that the sweep is the only thing
stopping it: nothing in the backup path has an opinion, so the day the sweep
does not run — a quiet instance, a failed unit — codes go back into snapshots
and nobody is told.

A code is short-lived and a snapshot is kept thirty days, so the practical
exposure is somebody who can read a backup learning which addresses were
invited and when. That is smaller than an account takeover and larger than
nothing.

## Work

- Exclude `content/.mail/` from the staged tree in `scripts/backup.sh`,
  alongside the `postcards/`/`photobooks/` strip that already happens there —
  B653 found those needed code too, since they are nested inside `content/`
  rather than top-level.
- Check the same question for `lib/exportZip.ts`: B636 verified an export
  walks only `trips/` and `config.json`, so `.mail` should already be absent —
  confirm rather than assume, and add the assertion if it is missing.
- One test: a `.mail` directory seeded under the content root is not in the
  staged tree.

Not doing: anything about where `content/.mail/` lives. Moving it is B636's
territory and it has already been argued; this is only about the copy that
outlives it.

## Acceptance

- A run with `content/.mail/` populated stages no `.eml`.
- `test/backup-script.test.ts` fails if that regresses.
