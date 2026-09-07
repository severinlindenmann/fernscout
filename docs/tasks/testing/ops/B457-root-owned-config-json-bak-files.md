---
id: B457
title: Root-owned config.json.bak files keep appearing in the content root, and each one fails a nightly backup
type: OPS
priority: medium
complexity: low
area: backups
found: "2026-09-05T12:51:15Z"
started: "2026-09-07T11:06:01Z"
merged: "2026-09-07T11:23:39Z"
---

# B457 — Root-owned config.json.bak files keep appearing in the content root, and each one fails a nightly backup

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

## Triage

The technical failure mode this ticket describes — a stray unreadable file
failing the *whole* nightly run — is already fixed, by B653 (merged as
`31687e50`, "the backup set is an allowlist and the env file is in it").
`scripts/backup.sh` no longer copies `content/` (or `DATA_DIR`) wholesale; it
stages an explicit allowlist, and `config.json` is staged by exact name only
(`scripts/backup.sh:432`, `stage_file "config.json" "$DATA_DIR/config.json" …`).
A `config.json.bak*` file sitting beside it does not match `*.json` in the
"say what else is under DATA_DIR" sweep (`scripts/backup.sh:472-486`) and is
therefore never attempted — it is named on stdout as `skipped … (not in the
backup set)` and has no bearing on the run's exit code or its
`.backup-last-success` stamp. Root ownership of such a file no longer fails a
backup at all; this was reproduced by reading the current script rather than
by running it (it needs a real `DATA_DIR`/systemd context this worktree does
not have).

What B653 did not touch, and what this ticket is actually left holding, is
option 1 from the Work section above — telling people how the file gets
there in the first place so root-owned stragglers stop accumulating and
needing manual `chown`/deletion. That is now written into the runbook: see
`docs/runbook.md`, the note directly below the "Three lifecycles, three
places" table, added by this change — edit `$DATA_DIR/config.json` as
`sudo -u fernscout`, and if a safety copy is wanted, take it outside
`DATA_DIR` (e.g. `/root/fernscout-config-backups/`) rather than beside the
live file.

Options 2 (copies live outside DATA_DIR) and 3 (a deploy-time readability
check) are covered by the same runbook addition and by B651's note that a
stray unreadable file can no longer fail the run — no code change was made
here beyond the doc.

**Not done, and not this ticket's to do:** running `sudo find
/var/lib/fernscout ! -user fernscout` on the live VPS, or chowning/removing
any file found. That is server access this worktree does not have. A person
should run that spot check after reading the new runbook note, and clean up
any existing root-owned `config.json.bak*` files by hand
(`sudo chown fernscout:fernscout <file>` or `sudo rm <file>`, whichever is
still wanted — B651 documents the same decision for the two backups found
there).
