---
id: B1151
title: macOS AppleDouble files are synced into the demo journal's originals on the server
type: CHORE
priority: low
complexity: low
area: ops, content, deploy
found: "2026-09-09T18:38:35Z"
---

# B1151 — macOS AppleDouble files are synced into the demo journal's originals on the server

Found during B108, on fernscout.ch on 2026-09-09.

## Why

`/var/lib/fernscout/content/example/trips/parks-2025/originals/` holds 18
directories of photographs and 18 files beside them named `._arches-at-dusk`,
`._back-to-denver` and so on — 163 bytes each. They are macOS AppleDouble
resource forks, carried across by the rsync in `.claude/skills/vps/ship.sh`
from a Mac checkout.

Nothing is broken. The photobook run read the 43 real photographs and ignored
these; `find … -type f ! -name "._*"` is the only reason anybody would notice.
The cost is that a directory listing of the demo journal's originals shows
twice as many entries as there are days, and any future code that scans that
folder rather than reading the plan will trip over them.

Filed because AGENTS.md says anything noticed goes in the backlog, and because
the fix is one rsync flag rather than a decision.

## Work

Delete the existing ones on the host, and stop making new ones: rsync's
`--exclude='._*'` (and `--exclude='.DS_Store'` while there) in `ship.sh`.

`ship.sh` is gitignored — it knows this instance's host and domain — so this is
an edit to the local file, not a commit. Say so in the ticket when it is done,
since the change will be invisible to anybody reading the repository.

## Acceptance

- `find $CONTENT_DIR -name '._*' | wc -l` is 0 on the host.
- A subsequent `ship.sh` run does not recreate them.
