---
id: B651
title: Two root-owned config backups in DATA_DIR make every nightly snapshot partial
type: OPS
priority: high
complexity: low
area: backup, VPS, file ownership
found: "2026-09-07T04:59:19Z"
started: "2026-09-07T11:06:03Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:06:03Z"
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
