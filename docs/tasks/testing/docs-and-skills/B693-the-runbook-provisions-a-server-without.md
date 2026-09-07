---
id: B693
title: The runbook provisions a server without ffmpeg, and the deploy never mentions it
type: DOCS
priority: medium
complexity: low
area: ops, docs
found: "2026-09-07T10:00:34Z"
started: "2026-09-07T10:01:03Z"
merged: "2026-09-07T10:06:45Z"
---

# B693 — The runbook provisions a server without ffmpeg, and the deploy never mentions it

## Why

`docs/runbook.md` §2 installs `nodejs git build-essential python3`, and nothing
in the provisioning chapter mentions ffmpeg. So a server built by following the
runbook — which is how fernscout.ch was built — cannot accept a single clip
through either door, and the person who built it has no reason to suspect it.
`docs/ingest.md` does say ffmpeg is needed, but that is the CLI's page and a
person setting up a server never opens it.

Found on 2026-09-07: `which ffmpeg` on the live instance answered nothing,
after a day's work raising the clip limits that instance could not use.

## Work

- Add ffmpeg to the runbook's provisioning step, with one line on what is lost
  without it — photographs work, clips are refused — so an operator who does
  not want 100 MB of codecs can make that choice knowingly.
- `scripts/deploy.sh` prints one more line beside the `backup:` and `logging:`
  lines it already ends with: whether video can be taken. Reporting, never
  installing — a deploy runs on every push as root, and one that quietly
  `apt install`s changes the machine on a docs-only push. Provisioning is the
  runbook's job and has to work on a VPS that is not Debian.
- The `deploy` skill's troubleshooting table gets the symptom: clips refused,
  photographs fine.

## Acceptance

- The runbook names ffmpeg where it names node.
- A deploy prints the video line, on both answers.
