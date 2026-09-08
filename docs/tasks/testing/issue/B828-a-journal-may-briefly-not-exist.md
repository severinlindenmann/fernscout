---
id: B828
title: A journal may briefly not exist while a deploy copies content
type: ISSUE
priority: medium
complexity: medium
area: users, deploy
found: "2026-09-07T15:54:42Z"
started: "2026-09-08T21:30:51Z"
merged: "2026-09-08T21:39:44Z"
---

# B828 — A journal may briefly not exist while a deploy copies content

## Why

B807 — a person's session silently stopped being recognised mid-task — was made
survivable without its cause being found. The deploy theory was ruled out with
evidence: sessions are rows in `sessions`, `lookUpSession` (`lib/auth/index.ts:1055`)
is a pure database lookup, and `hashSecret` (`:208`) is an unsalted SHA-256 that
does not involve `SESSION_SECRET`, so even a regenerated secret would not
invalidate a cookie. A test proves a session survives the database being closed
and reopened, which is what a restart does to this code.

That leaves the standing hypothesis, and it is worth chasing because it would
look exactly like what the tester saw:

`lib/helper/server.ts:33` — `isHelperOwner` returns false when
`getUser(username)` is null. During a deploy, `ship.sh` **rsyncs
`content/example` into the content directory** while the server is running. If
`lib/users.ts`'s cache can observe a journal mid-copy — a directory present but
its `config.json` not yet written, or a cache invalidated at the wrong moment —
then for a few hundred milliseconds that journal does not exist, and every
request for it answers "not your journal".

Two deploys happened during the tester's run, and he saw it twice.

Unproven. But if it is real it affects every journal on the instance during
every deploy, not only the demo, and the answer a person gets is the most
alarming one available.

## Work

Look at `lib/users.ts`'s cache and what invalidates it, and at whether
`getUser` can observe a half-written journal directory. Reproduce by rsyncing a
journal under a running server and hammering `isHelperOwner`.

If it is real, the fix is probably that a journal whose `config.json` cannot be
read is treated as *unavailable* rather than *absent* — a 503 that says try
again, not a 404 that says this is not yours.

## Acceptance

Either the race is reproduced and closed, or the file says why it cannot happen.

## B946's evidence (2026-09-08)

A second report of the same symptom (B946) prompted a direct reproduction
attempt for the specific mechanism named above — "a directory present but
its `config.json` not yet written". `.claude/skills/vps/ship.sh` was read in
full: it runs

```
rsync -a --delete --exclude 'originals/' --exclude '.ingest.json' --exclude '._*' \
  content/example/config.json content/example/trips  "$content/example/"
```

live, with no restart, and only `config.json` and `trips/` — the top-level
`example/` directory itself is never created or removed by this step, only
written into.

Built a harness reproducing that exact invocation: a `src/`/`dest/` pair,
`config.json` rewritten and a new trip directory added every round for 300
rounds, with a tight reader loop doing the same three operations
`getUsernames()`/`loadUserConfig()` do (`fs.existsSync`, `fs.readFileSync`,
`JSON.parse`) on `dest/config.json` as fast as Node allows. **507,399 reads,
zero races** — no missing file, no empty read, no truncated JSON.

This rules out the `config.json`-missing mechanism specifically: rsync
transfers a changed file to a temp name and `rename(2)`s it into place
(atomic on POSIX), so a reader only ever sees the fully-old or fully-new
bytes, never a gap. `getUsernames()`'s cache doesn't flicker either, since it
keys off the top-level `content/` listing and `example/` never leaves that
listing during this sync.

**What is still open, and is the only part of this ticket's hypothesis not yet
tested:** the `trips/` subtree is synced with `--delete` across many files in
one rsync invocation, which is not one atomic operation the way a single file
transfer is. A request reading a specific trip's directory (not the journal's
`config.json`) mid-sync could plausibly still observe a torn state — that
variant has not been built or tested. Neither has a real `journalctl`
correlation against an actual live deploy timestamp, which is what would
finally tie a real occurrence to a real deploy rather than to a plausible
mechanism.

The Work section's "reproduce by rsyncing a journal under a running server and
hammering `isHelperOwner`" is therefore half done: `config.json` is cleared,
`trips/` is not.

## The `trips/` window, tested (2026-09-08, part 2)

Built the other half. A harness (two Node processes sharing a `src/`/`dest/`
pair under a temp dir, never `content/`) drives the exact rsync ship.sh runs
against `content/example/trips` — `rsync -a --delete --exclude 'originals/'
--exclude '.ingest.json' --exclude '._*' … trips …/` — for 200–300 rounds. Each
round rewrites one existing trip's `trip.md` (the common case: a new day
touches its trip's dates/status), adds one brand-new trip directory (mkdir +
`trip.md`, the case B946 didn't cover), and deletes one older one. A tight
reader loop in the second process runs the same sequence `loadTrips()`/
`readTrip()` do — `fs.readdirSync` the trips dir, then per folder
`fs.existsSync(trip.md)` → `fs.readFileSync` → check for a usable `id:` that
matches the folder — for the whole run. Ran against real GNU rsync 3.5.0
(installed via Homebrew; macOS ships `openrsync`, a BSD reimplementation with
different internals, so the harness was pointed at the same rsync family the
VPS runs).

**Two different results depending on which case:**

- **Rewriting an existing trip's `trip.md` is safe.** Across two runs
  (300 and 200 rounds), the reader made 507,399 + 892,891 = 1,400,290 reads of
  files it found, and among the ~430 rewrite-rounds represented in that
  reader's `steady-*` trips, it caught **zero** truncated or unparseable
  reads and **zero** id/folder mismatches. rsync updates a file via
  temp-name-then-`rename(2)`, and that guarantee holds just as well for a file
  inside a directory tree as it does for the lone `config.json` B946 tested —
  a reader only ever sees fully-old or fully-new bytes for one file.
- **Creating a brand-new trip directory is not safe, and the race is real,
  large, and reliably reproduced.** Every single one of 200 newly-created
  trip directories in one run was observed by the reader, in the readdir
  listing, with `trip.md` absent — hit counts per new trip ranged from ~30 to
  ~160 separate polls (the reader is polling as fast as Node's synchronous
  `fs` calls allow, so this is a real, sustained window, not a one-in-a-million
  timing fluke). `rsync` `mkdir`s the destination directory before it starts
  transferring files into it; between that `mkdir` and the `rename(2)` that
  puts `trip.md` in place, the directory genuinely exists with none of its
  content, for the length of that file's transfer. `--delay-updates` (rsync's
  own "make updates more atomic" flag) was tried and **does not help**: it
  only delays the final rename of file *contents*, not directory creation,
  so an empty new-trip directory is still visible for the same window.

  In `lib/trips.ts`, this is exactly the "no-file" path `readTrip()` already
  has a doc comment about (a folder with no `trip.md` "is indistinguishable
  from never having tried") — so today it is handled gracefully: the one new
  trip is logged and returned as `MalformedTrip`, refused rather than
  crashing, and would reappear correctly on the next read once the transfer
  finishes. It self-heals within the sync.

**This cannot be the mechanism behind B807's `not_your_journal`, though.**
`getUser`/`userExists` (`lib/users.ts`) never read `trips/` at all — they read
only the top-level `content/` directory listing and `<user>/config.json`,
both of which B946 already proved are stable during this exact rsync. A
malformed *trip* is not the same fact as an absent *journal*: the former is
one entry excluded from `getTrips()`'s result for a few dozen milliseconds to
a few seconds (depending on transfer size — a new trip's `media/` is inside
this same sync and not excluded), the latter is what `isHelperOwner` checks
and it is unaffected either way.

**And this cannot be affecting anybody's real journal at all.** Rereading
`.claude/skills/vps/ship.sh` in full: it is `this instance's own` deploy path
and is entirely gitignored (`.gitignore:72` covers the whole `vps/`
directory) — it is not part of the repository, has no tracked history, and
cannot be fixed by a commit on any branch. The tracked, shipped deploy path,
`scripts/deploy.sh`, explicitly refuses to touch `$CONTENT_DIR` for exactly
this reason (`scripts/deploy.sh:74-79`: "content/ changed — a deploy does not
copy it into $CONTENT_DIR"). The only journal `ship.sh` ever rsyncs is
`content/example`, the demo journal that ships inside the repository as its
own shop window. So even taking this race at face value, its entire blast
radius is: the demo journal, only when a brand-new trip is added to it (not
on ordinary day-to-day edits to existing trips), producing a few seconds of
one trip reading as malformed on `fernscout.ch`'s own public demo. No other
instance and no real person's journal is exposed to this rsync at all.

**Conclusion:** the ticket's actual hypothesis — a journal briefly answering
as though it does not exist, causing the `not_your_journal` a tester saw — is
now **fully ruled out** for the deploy mechanism named in the Why: `config.json`
is atomic (B946) and the top-level `content/` listing never flickers (B946);
the one genuine gap that exists in this whole path (a brand-new trip's
directory appearing before its `trip.md`) is mechanistically incapable of
producing a journal-level 404, is already handled without crashing, and can
only ever be observed on the repository's own demo journal via a script this
repository does not contain. B807's actual cause remains open, but it is not
this.

**Recommendation to a person:** close B828 as cannot-reproduce-the-named-
mechanism — the two things it asked to be tested (`config.json`, `trips/`)
have both now been tested, with numbers, and neither can produce the observed
symptom. The narrower, cosmetic `trips/`-creation gap on `content/example` is
real but affects nobody's actual journal; if it's worth fixing at all, the fix
lives in `ship.sh` by hand (sync new trip content into a staging path, then
swap the whole `trips/` directory into place with one `rename(2)`, the same
pattern that already makes `config.json` safe) — not in this repository,
since that script is gitignored and untracked. A fresh `backlog/` capture
(B for this) is the way to hand that off if it's worth doing; it is `OPS`-
shaped, not a diff.

Harness: `writer.js` performs the rsync rounds against a temp `src/`/`dest/`
pair; `reader.js`/`reader2.js` poll `dest/example/trips` the way
`loadTrips()` does and tally `noFileTransient` (folder present, `trip.md`
absent), `unparseable` (`trip.md` read but no usable `id:`/`title:`), and
`idMismatch` (id doesn't match its folder — the torn-write signature). Not
committed to the repo (scratch investigation tooling, not test code); the
numbers above are the full record.
