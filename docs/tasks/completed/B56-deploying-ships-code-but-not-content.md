---
id: B56
title: Deploying ships code but not content/locales, so translations never reach the live site
type: ISSUE
priority: high
complexity: low
area: deploy, i18n, ops
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-03"
---

# B56 — Deploying ships code but not content/locales, so translations never reach the live site

## Why

Found by testing fernscout.ch immediately after deploying B35, B37, B38 and
B41. The deploy reported healthy and the code was current, and the site was
still serving translation files from **2026-08-31**.

The server reads `CONTENT_DIR=/var/lib/fernscout/content`. `scripts/deploy.sh`
does `git pull` into `/srv/fernscout`, so `/srv/fernscout/content/locales/`
updates and the directory the app actually reads does not. The copy between
them (`cp -a /srv/fernscout/content/. /var/lib/fernscout/content/`,
`docs/archiv/runbook.md:113`) is a **one-time setup step** and nothing repeats
it.

Measured on the live server after a successful deploy:

```
en.json: repo=432  server=382   (50 keys missing)
de.json: repo=432  server=382   (50 keys missing)
hu.json: repo=432  server=382   (50 keys missing)
```

Every string added or changed since 2026-08-31 is absent, including all of
B38's deletion copy and B37's rewritten `err.linkExpiredBody`. The three keys
B37 deleted (`me.newHere`, `contact.adminOpenLink`,
`contact.adminOpenLinkHint`) are still being served.

**It does not look broken, which is why it survived.** No page shows a raw key
and nothing 500s. What is lost is silent.

### Corrected while building it (2026-09-01)

The mechanism above is right and the *effect* described below it was wrong, in
a way worth recording because it changes which strings are actually damaged.

`lib/locales.ts:localeFiles()` reads **two** files and merges them: the shipped
`<cwd>/content/locales/<code>.json` first, then `<CONTENT_DIR>/locales/…` on
top, key by key. `cwd` on the VPS is `WorkingDirectory=/srv/fernscout`, which
`git pull` does update. So the copy under `CONTENT_DIR` is not the only
dictionary — it is an **override layer**, and the harm is not what was written
here first:

| | |
| --- | --- |
| A key **added** since the seed copy | fine — the override has no opinion, the shipped string wins. All 55 new keys, `del.*` included, render in German today |
| A key **reworded** since the seed copy | **broken** — the stale override wins, for ever. 4 strings in English, 9 in German, 7 in Hungarian |
| A key **deleted** since the seed copy | **broken** — the override resurrects it: `me.newHere`, `contact.adminOpenLink`, `contact.adminOpenLinkHint` are still being served |

Measured live, `GET https://fernscout.ch/` with `Accept-Language: de`, before
any fix:

```
served: "Deine Reisen sind Markdown und Fotos in einem Ordner, der dir gehört…"
repo:   "Dein Reisetagebuch besteht aus Markdown-Dateien und Fotos in einem Ordner…"
```

So the deletion-confirmation page was never the victim — it renders correct
German, because its keys are new. The victim is every string the project has
*reworded*, which is the harder failure to notice: the site disagrees with the
repository and looks perfectly fine doing it.

The runbook already knew (`docs/archiv/runbook.md`): "Do not keep a copy of
`locales/` unless you mean to override it", added 2026-08-31 18:42 in b712a7c.
The seed copy on the VPS is dated 21:15 the same evening, so the advice existed
and the copy was taken anyway — which is the argument for a deploy step over a
paragraph.

### Were the server's strings hand-edited?

No — checked before writing the sync, as the task asked. Every shared key whose
text differs between the VPS and the repository was searched for in the git
history with `git log -S "<the server's exact string>" -- content/locales/<c>.json`,
and every one of them is a string this repository itself shipped and later
changed:

| Key | The server's text was removed by |
| --- | --- |
| `landing.lede`, `landing.publicTitle`, `landing.step1Body`, `landing.step2Body`, `landing.step3`, `landing.step3Body` | 34a362f, 2026-09-01 17:21 |
| `contact.mailCodeBody`, `me.signInSent` | 8cf5675 (B40), 2026-09-01 19:00 |
| `err.linkExpiredBody` | e624d83 (B37), 2026-09-01 19:19 |

All three keys the task named are on that list, all of them changed *after* the
seed copy, and none is an operator's customisation. Overwriting them is
therefore safe, and the first sync does exactly that.

For the case where it would not be safe, the sync leaves a directory alone if
it contains a `.keep-local` file — an instance that really does want its own
wording marks it, and the deploy says so in its output instead of quietly
replacing it.

The split itself is right and should not be flattened. `content/` holds two
different kinds of thing:

| | |
| --- | --- |
| **Shipped with the code** | `locales/`, `rates/` — belongs to the release |
| **Owned by the operator** | `config.json`, `<username>/` — must never be overwritten by a deploy |

A blanket `cp -a` at deploy time would destroy journals. That is presumably why
nobody added one, and the answer is to sync the shipped half only.

## Work

- Sync `content/locales/` into `CONTENT_DIR` as a deploy step, before the build.
  `rates/` deserves the same treatment or an explicit decision that it does
  not — B17 is the related question of how a trip gets its rates.
- Deleted keys must actually disappear, so the sync replaces the directory
  rather than merging into it. `me.newHere` is still on the server precisely
  because a merge would have kept it.
- Never touch `config.json` or any `<username>/` directory. A test or a
  guard that fails loudly if the sync would write outside `locales/` is worth
  more than a comment saying not to.
- Say in the runbook that `content/` is two things with two lifecycles, in the
  table above. The one-time copy at `runbook.md:113` should say it is seeding
  operator content only.

One thing to check before writing the sync: whether the server's current
locale files were ever hand-edited. Comparing them against the repo shows a
handful of shared keys with different text (`landing.lede`,
`contact.mailCodeBody`, `err.linkExpiredBody`), and every one of those is
explained by a repo change since the setup copy — but that was not proved, and
overwriting an operator's customised string is exactly the harm this task is
otherwise preventing. Check the git history for each before the first sync
runs, or take a copy of the server's files first.

## Built

`scripts/sync-shipped-content.sh`, called from `scripts/deploy.sh` after the
pull and before the build, and available as `npm run content:sync`.

- It copies `locales/` and `rates/` from the repository's `content/` into
  `$CONTENT_DIR`, **replacing** each directory (staged into `.incoming-<name>`
  and swapped, so a reader never sees half a dictionary). A key deleted from
  the repository is therefore gone.
- **`rates/` is synced too**, which is the explicit decision the task asked
  for. `lib/rates.ts:ecbCachePath()` reads `contentRoot()/rates/ecb.json` and
  has no shipped fallback at all, so unlike `locales/` it was not merely stale
  on the VPS — it was frozen at whatever the seeding copy left, and
  `npm run rates:update` writes the file *in the repository*, to be committed.
  That is the definition of shipping with the release. B17 remains the separate
  question of how a trip gets its rates.
- The names it may write are one hardcoded list, every destination is asserted
  to be exactly one level under `$CONTENT_DIR`, and the copy is verified with
  `diff -r` afterwards. `test/sync-shipped-content.test.ts` runs the real script
  against a fixture holding a `config.json` and a journal and asserts, by
  content and by mtime, that neither moved; replacing the body of the script
  with `cp -a content/. $CONTENT_DIR/` makes that test fail, which is the point
  of it.
- The list is held against `INSTANCE_DIRS` in `lib/users.ts` (now exported) by
  the same test: the two are the same two names for the same reason — they are
  not people — and adding a third to one and not the other would silently stop
  shipping it.
- `docs/archiv/runbook.md` now carries the two-lifecycles table, seeds only the
  operator's half by hand, and gives two commands for checking a deploy:
  `diff -r` for "the shipped half arrived", and a checksum over everything
  *except* the shipped half for "the operator's half did not move".

Note for the first deploy: `scripts/deploy.sh` pulls its own replacement partway
through, so the deploy that lands this change still runs the old script. The
sync happens on the **second** deploy — the runbook already says to deploy twice
and judge the second.

Found while reading, captured rather than absorbed: **B62** — every `docs/*.md`
link in `README.md` and in `.claude/skills/deploy/SKILL.md` is broken since the
docs moved to `docs/archiv/`.

## Acceptance

- After a deploy, `content/locales/*.json` under `CONTENT_DIR` is byte-identical
  to the repository's, asserted by a command in the runbook rather than by eye.
- A key deleted from the repo is gone from the server after the next deploy.
- `config.json` and every `<username>/` directory under `CONTENT_DIR` are
  untouched by a deploy — verified by mtime or checksum before and after.
- A German request for the deletion-confirmation page returns German.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
