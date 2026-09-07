---
id: B651
title: Two root-owned config backups in DATA_DIR make every nightly snapshot partial
type: OPS
priority: high
complexity: low
area: backup, VPS, file ownership
found: "2026-09-07T04:59:19Z"
started: "2026-09-07T11:06:03Z"
merged: "2026-09-07T11:23:39Z"
---

# B651 — Two root-owned config backups in DATA_DIR make every nightly snapshot partial

## Why

`/api/health` on fernscout.ch has reported `backup.state=failing` since
2026-09-07T01:35Z. The last run that finished was 2026-09-06T01:24Z.

The snapshot itself is being pushed — restic has it — but two files under
`DATA_DIR` cannot be read by the `fernscout` user the unit runs as, so the
run tags the snapshot `partial`, writes no `.backup-last-success` stamp, and
exits non-zero:

```
-rw------- 1 fernscout fernscout /var/lib/fernscout/config.json
-rw------- 1 root      root      /var/lib/fernscout/config.json.bak
-rw------- 1 root      root      /var/lib/fernscout/config.json.bak-b325
```

Both are hand-made copies of the instance config, taken with `sudo` during
earlier work — `-b325` names the task it was taken for. They are somebody's
safety copy, not something the software writes.

That is the whole fault, and it is small. What makes it worth a high priority
is what it costs while it stands: the alert is firing every night, and an
alert that is always firing is one nobody reads. The next real backup failure
arrives into a channel that has been crying wolf for a week.

Nothing here was caused by B636, which moved sent mail out of `content/` — the
server only took that change at 2026-09-07T02:0xZ, after this had already
failed twice. The first run under B636's `backup.sh` has not happened yet and
should be watched.

## Work

- Decide what the two files are for. If they are still wanted, `chown
  fernscout:fernscout` them; if they are spent, delete them. **A person's
  call, not an agent's** — they are somebody's deliberate safety copy of a
  file that holds this instance's configuration.
- Then re-run the unit by hand and confirm `/api/health` returns
  `backup.state` to healthy rather than waiting a day to find out.
- The deeper question, and the reason this is `OPS` rather than a one-line
  chore: **a stray unreadable file beside the config should not be able to
  fail the whole backup.** Consider whether `scripts/backup.sh` should refuse
  only on paths it expects to own, and merely warn about strangers. That is a
  judgement about what "complete" means for a snapshot, so it belongs in the
  task rather than in a quick fix.
- Watch the first nightly run that uses B636's `backup.sh` — it now strips
  `data/mail` from the staging directory, and this is the first deploy that
  carries it.

## Acceptance

- `curl https://fernscout.ch/api/health` reports the backup healthy.
- A nightly run completes without a `partial` tag.
- Either the two files are readable by the unit, or they are gone, and the
  task says which was chosen and why.

## Triage

The "deeper question" — should a stray unreadable file beside the config be
able to fail the whole backup — is already answered, by B653 (merged
`31687e50`, before this ticket was found on 2026-09-07T04:59Z but landed on
the server only later that day per the Why section). `scripts/backup.sh` now
stages an explicit allowlist rather than copying `DATA_DIR`/`content/`
wholesale: `config.json` is staged by its exact name
(`scripts/backup.sh:432`), and anything else directly under `DATA_DIR` —
including `config.json.bak` and `config.json.bak-b325` — falls through to the
"say what else is under DATA_DIR" sweep (`scripts/backup.sh:472-486`), which
only logs it as `skipped … (not in the backup set)` and does not touch the
run's exit status. Read the script itself for this — confirming it against
the live server is not something this worktree can do.

So the code half of this ticket is done and needs no further change here.
What is **not** done, and cannot be done from a worktree, is the live half:

**On the server, a person still needs to:**

1. Decide whether `/var/lib/fernscout/config.json.bak` and
   `/var/lib/fernscout/config.json.bak-b325` are still wanted.
   - If yes: `sudo chown fernscout:fernscout /var/lib/fernscout/config.json.bak
     /var/lib/fernscout/config.json.bak-b325` (or move them outside
     `DATA_DIR`, e.g. `/root/fernscout-config-backups/`, per the new runbook
     guidance in `docs/runbook.md`).
   - If spent: `sudo rm` them.
2. Confirm the fix actually reached the server by checking which commit
   `/api/health` is built from and whether it is at or after `31687e50`
   (B653) / this ticket's merge. Once B653's `backup.sh` is what the unit is
   running, these two files no longer need step 1 to make the backup
   succeed — but they should still be cleaned up or chowned, since a
   root-owned stray is still a maintenance smell even once it can't fail a
   run.
3. Run `sudo systemctl start fernscout-backup` by hand and confirm
   `curl https://fernscout.ch/api/health` reports `backup.state` healthy and
   a fresh `.backup-last-success` stamp.
4. Spot-check `sudo find /var/lib/fernscout ! -user fernscout` is empty
   afterward (same check B457 asks for).

None of steps 1-4 were run from this session — no server access here.
