---
id: B653
title: The backup set is everything under DATA_DIR minus what somebody remembered to subtract
type: CHORE
priority: high
complexity: medium
area: backup, DR, scripts/backup.sh
found: "2026-09-07T05:44:26Z"
started: "2026-09-07T05:48:16Z"
merged: "2026-09-07T06:27:23Z"
---

# B653 — The backup set is everything under DATA_DIR minus what somebody remembered to subtract

## Why

**Design: `docs/plans/W42-what-a-backup-owes.md`.** Step 1 of its Order, and
the only step that stands alone.

`scripts/backup.sh` stages everything under `DATA_DIR`, then subtracts: `rm
-rf "$STAGING_DIR/data/mail"` is the whole subtraction (B636). A set defined
that way grows by default, and on this instance it has:

```
553M  content/                     the payload
296M  home/.npm + home/.cache      npm cache, nightly, forever
 93M  example-before-b325.tgz      an archive left behind in June
```

Forty per cent of a 915 MiB snapshot is build cache and a stray tarball.

Worse in the other direction: **`/etc/fernscout/env` has never been backed
up.** It sits outside `DATA_DIR`, so a restore returns every journal and
photograph and cannot start the service — no `DATABASE_URL`, no VAPID keys,
no SMTP credentials, no `FERNSCOUT_ADMIN_EMAIL`.

And it is why B651 happened: two root-owned `config.json.bak` files nobody
needed made two nights `partial` and fired the alert twice.

## Work

- Replace the subtractive set with an allowlist: `db/postgres.dump`,
  `content/`, `$DATA_DIR/config.json`, and `/etc/fernscout/env` staged as
  `env/fernscout.env`.
- **Strip `RESTIC_PASSWORD` from the staged env file.** A backup carrying the
  key to itself is no use to somebody holding only the backup, and widens the
  blast radius if the repository leaks. The runbook must then say where that
  one secret is kept — see B656.
- **Log every top-level entry under `DATA_DIR` that was not staged.** This is
  not decoration: the allowlist moves the failure mode from "junk silently
  included" to "something new silently excluded", and this line is the only
  thing that catches the second. Without it, do not ship the allowlist.
- Leave B114's partial-snapshot machinery exactly as it is for the paths the
  set claims. An unreadable `content/` is still a failure, and must be.
- Exclude generated output — `postcards/`, `photobooks/`, `mail/`. Orders are
  rows in Postgres and sources are in `content/`; what is lost is a PDF that
  can be produced again.
- The env file is `root:fernscout 0640`. Check the unit can read it, and say
  in the task what you found rather than widening the mode.

Not doing: anything about Proton, rclone or a second destination. B654 and
B655.

**Added during the build, at the coordinator's direction (see "What was
built" below):** the allowlist also claims the sqlite database
(`DATABASE_URL=sqlite:…`, staged transactionally via `sqlite3 .backup` where
available) and every top-level `*.json` file `lib/store.ts` writes under
`DATA_DIR`. Filed as B658 first, then folded back in here because shipping the
allowlist without them is a data-loss regression for a documented
self-hosting shape (`docs/runbook.md:107`), not a scope question.

## Acceptance

- A run stages `content/`, the Postgres dump, `config.json` and the env file,
  and nothing else. The snapshot is around 555 MiB rather than 915 MiB.
- `env/fernscout.env` is present in a restored snapshot and contains no
  `RESTIC_PASSWORD`.
- The log names `home/` and `example-before-b325.tgz` as skipped.
- A root-owned unreadable file beside `config.json` does not make the run
  partial; an unreadable file under `content/` still does.
- `test/backup-script.test.ts` covers each of the four lines above.

## What was built, and what was found

**Layout.** `content/` is now staged at `content/` unconditionally — the
`is_inside()` nesting dance that used to skip a second stage when `CONTENT_DIR`
sat inside `DATA_DIR` (B444) is gone from the staging path entirely, because
`DATA_DIR` is no longer staged wholesale so there is nothing left to double up
against. `is_inside()` itself stays, repurposed as the one check the
skipped-entries log needs: without it, a nested `CONTENT_DIR` would show up as
a top-level `DATA_DIR` entry and get wrongly logged as "skipped" even though
step 2 just staged it as `content/`.

**RESTIC_PASSWORD stripped with `grep -v '^RESTIC_PASSWORD='`** — anchored on
the whole `KEY=` prefix, not a bare substring match. The env file is one
`KEY=value` per line (confirmed against `.env.example`'s shape); `grep -v`
therefore only ever drops lines that *are* that assignment, never a comment
that mentions the name, a neighbouring value that happens to contain the
string, or (there being no multi-line values anywhere in this file) a
continuation line. `AWS_SECRET_ACCESS_KEY` and the rest of the object-storage
credentials were considered as a second circular case — they too grant access
to the repository — and deliberately left in: they cannot *decrypt* a leaked
repository the way `RESTIC_PASSWORD` can, which is the specific blast-radius
argument W42 makes, and the design doc names only the one variable. Flagging
the distinction here rather than acting on it unasked.

**Generated output.** The ticket says excluding `postcards/`, `photobooks/`
and `mail/` "should require no code" — true for `mail/` (moved to `DATA_DIR`
by B636 and simply never in the allowlist) but not for the other two: both
live *nested inside* `content/<user>/`, not at a top level the allowlist could
skip for free. Staging `content/` wholesale therefore still copies them, so a
one-line `find … -exec rm -rf {} +` strips `content/<user>/postcards` and
`content/<user>/photobooks` back out after `stage_tree` has already run (same
shape as the pre-existing `data/mail` subtraction this replaces). Noted
because it contradicts the ticket's "no code" phrasing, not because the
outcome is in question.

**Env file permissions.** `root:fernscout 0640` with the unit's `User=fernscout
Group=fernscout` (`deploy/fernscout-backup.service`) is readable: 0640 grants
the owning group read, and the service's group is that file's group. No mode
change made or needed.

**Found, then fixed here rather than left to B658.** Filed B658 first for a
no-`DATABASE_URL` or `DATABASE_URL=sqlite:…` deployment's own state
(`reactions.json`, `push-subscriptions.json`, the sqlite file), on the
reasoning that a second problem found while building is a new capture, never
scope absorbed into the ticket in hand. The coordinator overrode that: this
ships to other people's servers, `sqlite:` is a documented deployment shape
(`docs/runbook.md:107`), and shipping an allowlist that silently drops
somebody's entire database on that shape is a data-loss regression in the
design and the ticket, not a scope question — so it belongs here. B658 is
resolved below rather than left open.

**The allowlist now claims, in full, and why this list is exhaustive:**

```
db/postgres.dump   pg_dump, when DATABASE_URL is postgres://…
db/fernscout.db    the sqlite file DATABASE_URL=sqlite:… points at
                   (lib/db/url.ts: dataDir()/fernscout.db), + -wal/-shm
content/           CONTENT_DIR, generated postcards/photobooks stripped back out
config/config.json $DATA_DIR/config.json
state/<name>.json  every OTHER top-level *.json file under DATA_DIR
env/fernscout.env  $ENV_FILE, RESTIC_PASSWORD stripped
```

The exhaustiveness claim rests on one fact about `lib/store.ts`: `readStore`/
`updateStore` write to `pathFor(name) = path.join(dataDir(), \`${name}.json\`)`
and nowhere else (`lib/store.ts:44`) — that is the *entire* file-store
convention, used today by `lib/repos/reactionsFile.ts` (`reactions.json`) and
`lib/repos/pushFile.ts` (`push-subscriptions.json`). `stage_json_stores`
therefore matches on the pattern (`*.json` at the top level, minus
`config.json`) rather than on those two names, so **a third store
`lib/store.ts` gains tomorrow is backed up without this script changing.**
The one way this list stops being exhaustive is a future store that keeps its
state somewhere other than a top-level `<dataDir>/<name>.json` file — a
subdirectory, a different extension, a different root entirely. Whoever adds
one should know the backup has an opinion about `dataDir()`'s top level:
grep this file's header comment (`state/<name>.json`) before assuming a new
call needs a script change, and add one only if the new state does not fit
the `*.json`-at-the-top pattern.

**The sqlite database is staged transactionally where possible.** A plain
`cp` of a live database can catch a write mid-flight and restore as silent
corruption — the database equivalent of the torn file B114 already guards
`content/` against, except nothing would flag it. `stage_sqlite` prefers
`sqlite3 "$src" ".backup '$dest'"` — SQLite's own online-backup API, safe to
run while the app keeps writing — checked via `command -v sqlite3` (the only
thing a bash script *can* check; `better-sqlite3`, mentioned in the ticket, is
a Node module with no binary to shell out to). Where `sqlite3` is not on
PATH, it falls back to `cp -a` of the main file plus its `-wal`/`-shm`
sidecars if present — WAL mode is what `lib/db/client.ts` turns on for every
sqlite file, so a fresh write often lives in `-wal` rather than in the main
file. **That fallback copy is CRASH-CONSISTENT ONLY, not transactionally
clean, and the script says so on stdout in those exact words** — SQLite
replays the WAL on open and recovers a clean crash, but three files copied at
three different instants is not the guarantee `.backup` gives, and nothing
here lets that pass silently as equivalent.

**RESTIC_PASSWORD stripped with `grep -v '^RESTIC_PASSWORD='`** — anchored on
the whole `KEY=` prefix, not a bare substring match. The env file is one
`KEY=value` per line (confirmed against `.env.example`'s shape); `grep -v`
therefore only ever drops lines that *are* that assignment, never a comment
that mentions the name, a neighbouring value that happens to contain the
string, or (there being no multi-line values anywhere in this file) a
continuation line. `AWS_SECRET_ACCESS_KEY` and the rest of the object-storage
credentials were considered as a second circular case — they too grant access
to the repository — and deliberately left in: they cannot *decrypt* a leaked
repository the way `RESTIC_PASSWORD` can, which is the specific blast-radius
argument W42 makes, and the design doc names only the one variable. Flagging
the distinction here rather than acting on it unasked.

**Generated output.** The ticket says excluding `postcards/`, `photobooks/`
and `mail/` "should require no code" — true for `mail/` (moved to `DATA_DIR`
by B636 and simply never in the allowlist) but not for the other two: both
live *nested inside* `content/<user>/`, not at a top level the allowlist could
skip for free. Staging `content/` wholesale therefore still copies them, so a
one-line `find … -exec rm -rf {} +` strips `content/<user>/postcards` and
`content/<user>/photobooks` back out after `stage_tree` has already run (same
shape as the pre-existing `data/mail` subtraction this replaces). Noted
because it contradicts the ticket's "no code" phrasing, not because the
outcome is in question.

**Env file permissions.** `root:fernscout 0640` with the unit's `User=fernscout
Group=fernscout` (`deploy/fernscout-backup.service`) is readable: 0640 grants
the owning group read, and the service's group is that file's group. No mode
change made or needed.

**The skipped-entries log** now excludes four kinds of already-claimed entry
instead of one: `config.json`, every `*.json` (so `stage_json_stores` never
needs its callers to know its own file names in advance), `fernscout.db` +
`-wal`/`-shm`, and `CONTENT_DIR` itself when nested inside `DATA_DIR`. Still
one line per genuinely unclaimed entry, every run — `home/`, a stray `.tgz`,
sent mail, and the two backup stamp files all still print.

**Test changes.** The B114 partial-run tests moved their stray/locked fixtures
from `dataDir` to `contentDir`, because `stage_tree`'s tree-diff machinery now
only ever runs over `content/`. Added: a test that an unreadable file *beside*
`config.json` does **not** make the run partial (the literal B651 shape,
inverted); a test that the skipped-entries log names `home/`,
`example-before-b325.tgz` and `mail/`, and does not name `config.json`,
`reactions.json`, `custom-store.json` or `fernscout.db`; a round trip that
seeds a real sqlite database (via `better-sqlite3`, WAL mode on, matching
`lib/db/client.ts`) and two JSON stores — one named like an existing store,
one named arbitrarily to prove the pattern is not two hardcoded filenames —
and reopens the restored database and parses the restored JSON to prove the
bytes are real, not merely present; a dedicated test that prunes `sqlite3` off
PATH and asserts the fallback copies the `-wal`/`-shm` sidecars byte-for-byte
and logs "CRASH-CONSISTENT ONLY"; a test that `postcards/`/`photobooks/`
nested under `content/<user>/` never reach a restored snapshot; and the former
B444/B401 nested-`CONTENT_DIR` tests were rewritten for the new layout
(content lands at `content/`, not `data/content`, and is not logged as
skipped).

`npm run verify`: build, tsc, eslint (pre-existing warnings only, no new
ones), and all 4009 vitest tests green. `bash -n scripts/backup.sh` and
`shellcheck scripts/backup.sh` both clean.
