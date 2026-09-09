---
id: B946
title: The owner's session stops being recognised partway through a sitting
type: ISSUE
priority: medium
complexity: medium
area: auth, session
found: "2026-09-08T10:45:26Z"
superseded: B828
---

# B946 — The owner's session stops being recognised partway through a sitting

## Why

Reported from outside, driving the live site: a cookie session that had been
answering as the owner for several calls began returning `not_your_journal`
partway through the sitting, twice, with nothing done to it in between. The
tester fell back to the six-digit code flow both times and could not pin the
cause down from where they stood.

This is the same symptom B807 already found once (session_lapsed messaging
shipped for it) and the same standing hypothesis B828 already captured and
left open ("a journal may briefly not exist while a deploy copies content").
Nothing here names a new mechanism the two existing tickets do not already
cover.

## Work

Investigated without changing any product code — this is a validate-and-close
ticket, not a fix.

1. **The "rotated cookie" theory, checked by code inspection and ruled out.**
   `GUEST_COOKIE` (`fs_session`) is written in exactly three places in the
   whole tree: `app/api/auth/verify/route.ts:114`, `app/api/auth/link/
   route.ts:65`, and `app/api/contacts/confirm/route.ts:85` — all three are
   the *act* of signing in. Nothing re-sets it for a request that is already
   authenticated, and `lookUpSession` (`lib/auth/index.ts:1055`) never mutates
   `token_hash`, only `last_seen_at`. There is no session-token rotation
   anywhere in this codebase, so a client silently missing a rotated
   `set-cookie` cannot be the mechanism — there is no such header to miss.

2. **The database-survival theory** was already closed by B828: sessions are
   rows, `hashSecret` is an unsalted SHA-256 independent of any runtime
   secret, and a session is proven to survive a database close/reopen (what a
   restart does to this code).

3. **B828's standing hypothesis — the deploy-time rsync race — reproduced and
   empirically weakened.** `.claude/skills/vps/ship.sh` (gitignored, this
   instance's own deploy) rsyncs `content/example/config.json` and
   `content/example/trips` into `$CONTENT_DIR/example/` live, with the server
   running and no restart:
   ```
   rsync -a --delete --exclude 'originals/' --exclude '.ingest.json' --exclude '._*' \
     content/example/config.json content/example/trips  "$content/example/"
   ```
   `getUser()` → `loadUserConfig()` → `readJson()` reads `config.json` with a
   plain `fs.readFileSync`, and `isHelperOwner` returns `false` (which
   `notYourJournal` then reports as the misleading `not_your_journal`, per
   B828) whenever that read fails. If rsync could leave `config.json`
   transiently absent or truncated mid-transfer, this would fire on exactly
   the demo journal, exactly during a deploy — matching "twice", one per
   deploy, that both B807's and B946's testers saw.

   Built a harness that reproduces `ship.sh`'s exact rsync invocation against
   a throwaway `src/`/`dest/` pair, rewriting `config.json` and adding a new
   trip directory every round (300 rounds), while a tight reader loop performs
   the same three checks `getUsernames()`/`loadUserConfig()` do —
   `fs.existsSync`, `fs.readFileSync`, `JSON.parse` — on `dest/config.json` as
   fast as Node will run it (scratchpad `b946/writer.sh` + `b946/reader.mjs`,
   not checked in). Result: **507,399 reads, 0 races** — no missing file, no
   empty read, no truncated JSON. This is the expected outcome given rsync's
   default per-file behaviour: a file that is *transferred* (not deleted) is
   written to a temp name and `rename(2)`d into place, which is atomic on
   POSIX, so a reader only ever observes the fully-old or fully-new bytes.
   `getUsernames()`'s own cache also never flickers here: it keys off the
   top-level `content/` directory listing, and `example/` never leaves that
   listing during this sync, so `userExists("example")` stays a cache hit
   throughout regardless of what is happening to files underneath it.

   This does not clear B828 outright — the `trips/` subtree is synced with
   `--delete` and multiple files, which is not one atomic operation the way a
   single-file transfer is, so a request reading a specific trip's directory
   mid-sync could still observe a torn state. But it specifically rules out
   the mechanism named in B828's own text ("a directory present but its
   `config.json` not yet written") for the file that decides
   `not_your_journal` — that particular read cannot race.

4. **No reproduction of a same-session-cookie failure was attempted against a
   live/running instance** — this worktree has no server to hold a session
   against, and no `journalctl` access to correlate a report's exact minute
   against an actual deploy. That correlation is what B828's Work section
   already asks for and is still open.

## Acceptance

No new mechanism found. The two candidates in the ticket's own Why —
"a rotated cookie" and "the tester's own client dropping a set-cookie" — are
addressed: the former does not exist in this code (proven by exhaustive grep
of every `GUEST_COOKIE` write site), and the latter is a client-side
possibility this repository cannot rule in or out. The remaining candidate,
the deploy-time content race, is B828's own hypothesis and is now partially
narrowed (config.json specifically) rather than closed; B828 is the ticket
that should carry it forward, including trying the `trips/`-directory
variant and a real `journalctl` correlation on the next live occurrence.

Superseded by B828, which already tracks this exact investigation and now
also carries this session's evidence (see B828's own file for the same
rsync-race write-up).
