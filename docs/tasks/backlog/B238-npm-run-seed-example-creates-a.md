---
id: B238
title: npm run seed:example creates a journal beside the code rather than in the content root
type: ISSUE
priority: low
complexity: low
area: scripts, content
found: "2026-09-04T08:20:16Z"
---

# B238 — npm run seed:example creates a journal beside the code rather than in the content root

## Why

Found while fixing **B219** — the same defect, in a script B219 did not name and
so deliberately did not absorb.

`scripts/seed-example-content.mjs:13,23` builds both ends of the copy from the
script's own location, never from `contentRoot()`:

```
const ROOT = path.join(import.meta.dirname, "..");
const SRC  = path.join(ROOT, "content", "example");
const DEST = path.join(ROOT, "content", username);
```

`CONTENT_DIR` is not consulted. On a laptop the two are the same string and
nothing looks wrong. On a deployed instance the content root is under `DATA_DIR`
and `ROOT` is the code checkout, so `npm run seed:example -- --user someone`
produces a complete journal — `config.json`, trips, entries, media — inside the
directory `git pull` runs in, where:

- the running site never reads it, because the app resolves everything through
  `contentRoot()`. The command reports success and the journal does not exist as
  far as the site is concerned;
- it is outside the backup, for the same reason B219 and B111 were;
- it is untracked content sitting in a git checkout that a deploy pulls into.
  `content/*/postcards/` and friends are gitignored by name; a seeded journal
  directory is not.

Smaller than B219 in one respect: this writes generated placeholder content, not
somebody's postal address. Larger in another: what it creates is a whole journal
with a username, which is the unit the rest of the system reserves and
tombstones.

`scripts/migrate-users.ts:23` and `scripts/migrate-owner.ts:68` in the same
folder already do it correctly (`process.env.CONTENT_DIR ?? path.join(ROOT,
"content")`), which is what makes this look like an oversight rather than a
decision.

Not the same as `scripts/update-rates.mjs`, which also writes to
`ROOT/content/` and is **right** to: the ECB cache is repository data meant to
be committed, and B56 says so explicitly. The distinction is user-owned content
versus shipped data, and only the first belongs under `contentRoot()`.

## Work

- Resolve `SRC` and `DEST` through `contentRoot()`.
- Decide what `SRC` should be when the content root has no `example` journal —
  a deployed instance may not ship one. Falling back to the checkout's copy for
  the *source* while writing the *destination* into the content root is probably
  right, since `content/example/` is shipped reference content, but say so in
  the file rather than leaving it implied.
- Check the `--force` path and the "already exists" refusal still look at the
  right directory once both move.

## Acceptance

- With `CONTENT_DIR` set to a directory outside the checkout, `npm run
  seed:example -- --user someone` creates `$CONTENT_DIR/someone/` and adds
  nothing under `content/` in the checkout.
- With `CONTENT_DIR` unset, the behaviour is unchanged.
- The run reports a path that finds the journal it made.
