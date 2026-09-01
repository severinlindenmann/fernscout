---
id: B56
title: Deploying ships code but not content/locales, so translations never reach the live site
type: ISSUE
priority: high
complexity: low
area: deploy, i18n, ops
found: "2026-09-01"
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

**It does not look broken, which is why it survived.** `lib/i18n.ts` falls back
to the English defaults compiled into the bundle, so no page shows a raw key
and nothing 500s — the live deletion-confirmation page renders correct English.
What is lost is silent: a German or Hungarian reader gets English for anything
added since the setup copy. The first place that lands is the deletion
confirmation page and its mail, which is the last thing somebody reads before a
journal is permanently deleted.

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

## Acceptance

- After a deploy, `content/locales/*.json` under `CONTENT_DIR` is byte-identical
  to the repository's, asserted by a command in the runbook rather than by eye.
- A key deleted from the repo is gone from the server after the next deploy.
- `config.json` and every `<username>/` directory under `CONTENT_DIR` are
  untouched by a deploy — verified by mtime or checksum before and after.
- A German request for the deletion-confirmation page returns German.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
