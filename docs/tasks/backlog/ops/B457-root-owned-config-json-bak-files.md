---
id: B457
title: Root-owned config.json.bak files keep appearing in the content root, and each one fails a nightly backup
type: OPS
priority: medium
complexity: low
area: backups
found: "2026-09-05T12:51:15Z"
---

# B457 — Root-owned config.json.bak files keep appearing in the content root, and each one fails a nightly backup

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B401 was two of these. Four hours after they were cleared, two more had
appeared — `content/config.json.bak-20260905-143215` and
`content/example/config.json.bak-20260905-143215`, both `root:root 0600`, both
created while somebody worked on the live config. They were cleared too. That
is four in one day.

Every one of them fails that night's backup: the unit runs as `fernscout`,
cannot read a root-owned 0600 file, and correctly refuses to record an
incomplete snapshot as a success (B114). Nothing here is wrong with the backup.
The pattern is that an operator or an agent edits `content/config.json` with
`sudo`, keeps a copy beside it, and the copy inherits root.

Nothing in the repository writes these — `grep -rn "bak-"` finds only the
runbook's Caddyfile line. They are made by hand, at the shell, one session at a
time, which is why fixing the last four fixed nothing.

## Work

Operator practice, and possibly one line of enforcement. Options, cheapest
first:

1. Say it where it will be read: editing the live config means
   `sudo -u fernscout`, and a copy kept beside it is made the same way. The
   runbook's config section is the place.
2. Keep the copies somewhere that is not the content root — they are not
   content, and `content/` is what the backup must be able to read whole.
3. A check in `scripts/deploy.sh` that names anything under `DATA_DIR` the
   service user cannot read, so a deploy says it rather than that night's
   backup saying it eight hours later.

Not doing: excluding `*.bak*` from staging. An unreadable file in the content
root is exactly what B114 exists to notice, and a filter that hides these hides
the next one that matters.

## Acceptance

A week with no `chown` needed, and `sudo find /var/lib/fernscout ! -user
fernscout` empty on a spot check.
