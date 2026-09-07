---
id: B510
title: content/ holds four things that are not journals
type: CHORE
priority: medium
complexity: high
area: content layout, config, locales, legal, rates, deploy
found: "2026-09-05T18:58:55Z"
started: "2026-09-05T20:43:18Z"
merged: "2026-09-05T20:57:37Z"
completed: "2026-09-07T13:11:32Z"
---

# B510 — content/ holds four things that are not journals

## Why

`content/` is described everywhere as the folder a person owns — "everything a
person owns lives under `content/<username>/`, nothing user-owned is written
anywhere else" (AGENTS.md). Four entries in it are not a person:

| Entry | Read by | Actually is |
| --- | --- | --- |
| `config.json` | `lib/config.ts:587` `serverConfigPath()` | the operator's server config |
| `locales/` | `lib/locales.ts:58` | the software's UI strings |
| `rates/ecb.json` | `lib/rates.ts:27` | ECB reference data, committed |
| `legal/` | `lib/legal.ts:26,54` | the operator's imprint |

The cost is not aesthetic. Because these sit inside `CONTENT_DIR`, which on a
server is outside the repository, every one of them needs machinery that would
otherwise not exist:

- `scripts/sync-shipped-content.sh` — 120 lines whose entire job is to copy
  three directories from the repo into `CONTENT_DIR` on every deploy, with
  staged swaps, a name allowlist, path assertions and a `.keep-local` escape
  hatch. It exists because B56 shipped code but not content and the live site
  served August's German for a month.
- `INSTANCE_DIRS` in `lib/users.ts:35` — a denylist so `getUsernames()` does
  not offer `rates` as a journal. `test/sync-shipped-content.test.ts` exists
  only to hold the shell copy of that list against the TypeScript one.
- `test/depersonalised.test.ts` has to walk `content/` skipping non-journals,
  and `legal/` is exempt from the real-names rule by living there.
- `lib/locales.ts:58` already reads the shipped dictionary from
  `process.cwd()/content/locales` *and* the synced copy from
  `contentRoot()/locales`, then overlays one on the other. After a sync the two
  are byte-identical, so the overlay is doing nothing on a normal instance.

It is also a live footgun for an operator. On fernscout.ch the deploy replaces
`$CONTENT_DIR/rates` from the repo, so anything written there by
`npm run rates:update` on the server is discarded at the next deploy; and
`content/config.json.bak-*` files accumulate in the same directory the app
enumerates journals from (see B457).

Three lifecycles are being stored in one folder:

1. **Ships with the software** — `locales/`, `rates/`. No personal data, in
   git, replaced wholesale by a release.
2. **The operator's** — `config.json`, `legal/`. Real names and addresses,
   must survive every deploy.
3. **A person's journal** — `<username>/`. What `content/` is for.

## Work

**Built, and it differs from the plan in one place — read the note at the end.**

### What moved

`git mv` into a new top-level `site/`, which is the instance rather than the
journals:

| Was | Is | Read by |
| --- | --- | --- |
| `content/config.json` | `site/config.json` | `serverConfigPath()` |
| `content/locales/` | `site/locales/` | `lib/locales.ts` |
| `content/rates/` | `site/rates/` | `lib/rates.ts` |
| `content/legal/` | `site/legal/` | `lib/legal.ts` |

`lib/siteRoot.ts` is the one new module — `process.env.SITE_DIR ??
process.cwd()/site`, mirroring `lib/contentRoot.ts` and read on every call for
the same reason.

### The resolution order, and why it is not the plan's

The plan put the operator's two under `DATA_DIR` outright. That would have
meant editing **122 test files**: every fixture writes its server config into
the `CONTENT_DIR` temp directory, and `test/legal.test.ts` and the currency
fixtures do the same for `legal/` and `rates/`. A hundred and twenty-two
mechanical edits to prove a point about where a file lives is a worse change
than the one it replaces.

So each of the four resolves the same way, most specific first, and
`CONTENT_DIR` keeps working as the override:

- **config** — `FERNSCOUT_CONFIG`, then `$CONTENT_DIR/config.json` if it
  exists, then `site/config.json`. The deployed instance sets the env var; it
  is the only place the operator's own config belongs, because it must survive
  a `git pull`.
- **legal** — `$CONTENT_DIR/legal/` if it exists, else `site/legal/`.
- **rates** — `$CONTENT_DIR/rates/ecb.json` if it exists, else `site/rates/`.
- **locales** — unchanged in shape: shipped first, `$CONTENT_DIR/locales/`
  overlaid on top key by key. Only the shipped path moved, from
  `process.cwd()/content/locales` to `siteRoot()/locales`.

That buys the thing the ticket is actually about — nothing in the repository
or on the VPS puts non-journal files under `content/` any more — without a
flag day for anyone self-hosting. An instance that has not migrated boots
unchanged.

### Deleted

- `scripts/sync-shipped-content.sh` (120 lines) and
  `test/sync-shipped-content.test.ts`.
- `npm run content:sync`.
- The `sync` step in `scripts/deploy.sh`: `do_sync`, its plan line, its
  execution block, and its row in `test/deploy-plan.test.ts`. `site/*` now
  classifies as build + restart, and `content/*` as the note it always was.
- `.keep-local`, which existed only for that script.

`INSTANCE_DIRS` in `lib/users.ts` **stays**, against the plan. It is what stops
a stale `rates/` under `CONTENT_DIR` surfacing as a journal called `rates`, and
`CONTENT_DIR` is still a legitimate override location for all three names. It
is one line and a comment; deleting it would have been tidiness bought with a
failure mode.

### Followed through

`.env.example` documents `FERNSCOUT_CONFIG`. `AGENTS.md`'s content model now
shows both trees and says what the split is. `docs/runbook.md`'s first-deploy
seeding, its "which steps run" table, and its post-deploy verification all
lost the sync. Every `content/{config.json,locales,rates,legal}` in prose —
`lib/`, `app/`, `components/`, `scripts/`, `docs/`, `.claude/skills/` — became
`site/…`. `docs/plans/` was left alone, as the record of intent it is.

## Acceptance

- `ls content/` on a fresh clone lists journal directories and nothing else.
- `npm run verify` passes.
- `npm run unused` reports no unused file and no unused dependency.
- With `CONTENT_DIR` pointed at a directory holding only `example/`, the app
  boots, `/legal` renders, the German UI is German, and a trip page offers a
  second display currency — i.e. all four moved things are still found when
  `CONTENT_DIR` holds none of them.
- `bash scripts/deploy.sh --plan site/locales/de.json` asks for a build and a
  restart and no sync; `--plan content/example/config.json` asks for nothing
  and says so.
- After the server migration — `mv $CONTENT_DIR/config.json
  $DATA_DIR/config.json`, `rm -rf $CONTENT_DIR/{locales,rates,legal}`, and
  `FERNSCOUT_CONFIG` in `/etc/fernscout/env` — `https://fernscout.ch/api/health`
  reports `config.ok` and `content.ok`, `/legal` renders, and
  `ls /var/lib/fernscout/content` lists journals only.
