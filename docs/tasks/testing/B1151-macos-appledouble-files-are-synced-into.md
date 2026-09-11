---
id: B1151
title: macOS AppleDouble files are synced into the demo journal's originals on the server
type: CHORE
priority: low
complexity: low
area: ops, content, deploy
found: "2026-09-09T18:38:35Z"
started: "2026-09-11T15:48:00Z"
merged: "2026-09-11T16:05:07Z"
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

**`ship.sh` was readable this session** (main checkout, `.claude/skills/vps/
ship.sh` — gitignored but not unreadable), and I read it rather than editing
it: this session's instructions forbid any write to the shared checkout,
gitignored file or not, so the rsync flag below is described rather than
applied.

**Half of the "one rsync flag" was already there, from B828, not B1151.**
Line 75 already reads:

```
--exclude 'originals/' --exclude '.ingest.json' --exclude '._*' \
```

`--exclude '._*'` landed as part of B828's atomicity fix (an unrelated rsync
change that happened to add it), before this ticket was even filed. Still
missing: `--exclude '.DS_Store'`, which the ticket also asked for. The
deploy-side fix for whoever holds `ship.sh` is one flag on that line:

```diff
- --exclude 'originals/' --exclude '.ingest.json' --exclude '._*' \
+ --exclude 'originals/' --exclude '.ingest.json' --exclude '._*' --exclude '.DS_Store' \
```

**That line cannot be where the reported files came from, though.** It
`--exclude`s `originals/` outright — the whole directory is never touched by
this sync, in either direction, `._*` or not. So the `._arches-at-dusk` /
`._back-to-denver` files the ticket found under
`content/example/trips/parks-2025/originals/` did not arrive via `ship.sh` at
all; nothing in this repository's regular deploy path writes to `originals/`
on the live host. `git ls-files` confirms `content/example/trips/*/originals/`
holds no tracked files despite the `!content/example/` gitignore exception
(checked directly), so they were not committed and pulled either. The
likeliest remaining explanation is a one-off manual copy (`scp`/`rsync`
straight into that directory) made to seed the demo trip's originals for the
photobook, run from a Mac where the source folder already carried its
resource forks — an operational step with no corresponding script in this
repository to fix.

**Checked the ingest and export sides named as the fallback, and both are
already clean — nothing to fix there:**
- `lib/ingest/index.ts:151` skips any `readdirSync` entry whose name starts
  with `.` while scanning a source folder for media, so `npm run ingest`
  cannot pick up an AppleDouble file as a photograph in the first place.
- `lib/exportZip.ts`'s `isDotfilePath` (added for B1387) already drops any
  path segment starting with `.` — `.DS_Store`, `._*`, `.ingest.json` — at
  every level of a trip's tree, in every export scope.

So the only actionable code change this ticket still names (the `.DS_Store`
flag on `ship.sh`) is one line in a file this session cannot write, and is
above verbatim for whoever holds it. Everything else here is either already
fixed (the `._*` flag, via B828) or not a code problem (the live `originals/`
files).

**Live cleanup, for the person with root:** `find
/var/lib/fernscout/content/example/trips/parks-2025/originals/ -name '._*'`
is the reported path. Since these arrived by hand rather than through any
repeatable sync, it is worth widening that check to
`find /var/lib/fernscout/content -name '._*' -o -name '.DS_Store'` once, in
case the same one-off copy touched more than this one trip.

## Acceptance

- `find $CONTENT_DIR -name '._*' | wc -l` is 0 on the host.
- A subsequent `ship.sh` run does not recreate them.


## The sweep, 2026-09-11 — 126 files, one trip, still there

Run with root on the live instance:

```
find /var/lib/fernscout/content \( -name '._*' -o -name '.DS_Store' \) | wc -l
126
```

Every one is under `content/example/trips/parks-2025/originals/` — `._01.jpg`
beside `01.jpg` in each day's folder, plus `._<dayname>` entries for the
directories themselves. Nothing outside that one trip, and no `.DS_Store` at all.

That confirms the diagnosis rather than the ticket's premise: `ship.sh`'s rsync
excludes `originals/` wholesale and has carried `--exclude '._*'` since B828, so
it cannot have put them there. A manual copy from a Mac into that one directory
did.

**They are still on the instance.** Removing them is a delete against the
owner's own content folder, so it is not an agent's to do unasked — the files
are junk metadata rather than anybody's photographs, but the folder is theirs.
The command, for whoever decides:

```
ssh 95.216.112.173 "find /var/lib/fernscout/content -name '._*' -delete"
```

Nothing reads them: `lib/ingest/index.ts:151` skips dotfiles when scanning, and
`lib/exportZip.ts`'s `isDotfilePath` strips them from an export. So they cost
disk and an untidy `ls`, and nothing else.
