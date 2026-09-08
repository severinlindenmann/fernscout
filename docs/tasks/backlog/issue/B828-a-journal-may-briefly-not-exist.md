---
id: B828
title: A journal may briefly not exist while a deploy copies content
type: ISSUE
priority: medium
complexity: medium
area: users, deploy
found: "2026-09-07T15:54:42Z"
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
