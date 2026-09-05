---
id: B510
title: content/ holds four things that are not journals
type: CHORE
priority: medium
complexity: high
area: content layout, config, locales, legal, rates, deploy
found: "2026-09-05T18:58:55Z"
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

Move (1) into the repository proper and (2) under `DATA_DIR`, leaving
`content/` holding journals and nothing else.

### Phase 1 — one helper, four readers

Add `lib/siteRoot.ts`, mirroring `lib/contentRoot.ts`:

```ts
export function siteRoot(): string {
  return process.env.SITE_DIR ?? path.join(process.cwd(), "site");
}
```

`git mv content/locales site/locales` and `content/rates site/rates`. Then:

- `lib/locales.ts` — shipped path becomes `siteRoot()/locales/<code>.json`;
  the override layer becomes `dataDir()/locales/<code>.json` (same overlay
  semantics as today, so a reworded instance keeps working, and the two paths
  can no longer be the same file).
- `lib/rates.ts` — `ecbCachePath()` becomes `siteRoot()/rates/ecb.json`.
  `scripts/update-rates.mjs` writes there, which is the repo, which is where
  it was already being committed from.

### Phase 2 — the operator's two

- `serverConfigPath()` becomes `process.env.FERNSCOUT_CONFIG ?? dataDir()/config.json`,
  falling back to `siteRoot()/config.json` when that file does not exist, so a
  fresh clone in dev still boots on a shipped default. `git mv
  content/config.json site/config.json`.
- `lib/legal.ts` reads `dataDir()/legal/<code>.md` first, then
  `siteRoot()/legal/<code>.md`. `git mv content/legal site/legal` keeps this
  instance's imprint deployed by `git pull` — which is the property B487 and
  the comment at `lib/legal.ts:6` are about — while an instance with its own
  imprint drops it in `DATA_DIR` and is never overwritten. `.keep-local` is
  not needed for either half.
- `test/depersonalised.test.ts` — add `site/legal/` to what it tolerates,
  and drop the `content/`-walking that skipped `locales`, `rates`, `legal`.

### Phase 3 — delete the machinery

- `scripts/sync-shipped-content.sh`, `test/sync-shipped-content.test.ts`,
  `npm run content:sync`, `INSTANCE_DIRS` and its use in `getUsernames()`,
  the `.keep-local` paths, and the `content:sync` step in `scripts/deploy.sh`
  (with its entry in `test/deploy-plan.test.ts`).
- `npm run unused` afterwards — knip's entry points in `knip.jsonc` name the
  sync script.

### Phase 4 — the three dot-directories (do it, but last)

`.cache/`, `.deleted/` and `.mail/` also sit at the content root and are also
not journals. They are already invisible to `getUsernames()` and cost nothing
today, so they are separable from the above:

- `lib/media.ts:195` `.cache/media` → `dataDir()/cache/media` (and
  `lib/deletions.ts:570`, which clears it).
- `lib/tombstones.ts` `.deleted/` → `dataDir()/deleted/`.
- `lib/mail/index.ts` — the no-journal spool `content/.mail/` →
  `dataDir()/mail/`. Per-journal `content/<user>/mail/` stays where it is; it
  is that journal's.

On fernscout.ch `DATA_DIR=/var/lib/fernscout` and `CONTENT_DIR` is
`$DATA_DIR/content`, so all of this stays inside the nightly backup with no
change to `scripts/backup.sh`.

### Migration on the server

One-time, in the deploy, before the first boot on the new code:

```bash
mv /var/lib/fernscout/content/config.json /var/lib/fernscout/config.json
rm -rf /var/lib/fernscout/content/{locales,rates,legal}
# phase 4 only:
mv /var/lib/fernscout/content/.cache   /var/lib/fernscout/cache
mv /var/lib/fernscout/content/.deleted /var/lib/fernscout/deleted
mv /var/lib/fernscout/content/.mail    /var/lib/fernscout/mail
```

`legal/` and `locales/` need no move — the repo copy becomes the source. Losing
`$CONTENT_DIR/legal` is losing a duplicate.

**Not doing:** a `SITE_DIR`-relocatable shipped set as the supported override
mechanism. `SITE_DIR` exists for tests and a packaging experiment; the
supported way to override a dictionary or an imprint stays "put your own under
`DATA_DIR`", because that is the only half a deploy must not touch.

**Not doing:** moving `docs/` or the demo content. `content/example/` is a
journal and stays a journal.

## Acceptance

- `ls content/` on a fresh clone lists journal directories and nothing else.
- `grep -rn "INSTANCE_DIRS\|keep-local\|sync-shipped" lib app scripts test`
  returns nothing.
- `npm run verify` passes, and `npm run unused` passes.
- With `CONTENT_DIR` pointed at a directory containing only `example/`, the
  dev server boots, `/legal` renders, the German UI is German, and a trip page
  offers a second display currency — i.e. all four moved things are still
  found when `CONTENT_DIR` holds none of them.
- After the server migration, `https://fernscout.ch/api/health` reports
  `config.ok` and `content.ok`, and `/legal` still renders.
