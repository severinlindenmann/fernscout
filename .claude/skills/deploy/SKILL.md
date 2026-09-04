---
name: deploy
description: Ship Fernscout to the VPS and confirm it is actually healthy — verify locally, push, run scripts/deploy.sh, check /api/health. Use when the user says "deploy", "ship it", "push it live", "release", or asks why the live site is not showing a change.
---

# Deploy

A deploy is a pull, an install, a build and a restart, run on the machine that
serves. There is no image and no artifact to ship — that is why there is no
Docker here. Full reference: `docs/runbook.md`.

> **Check for `.claude/skills/vps/` first.** If it exists, this instance has
> its own one-command deploy path — host, ssh alias and how much local
> verification it keeps — and that skill is the one to follow. It is
> gitignored, so a fresh clone has only this file, which is the generic
> procedure and works on anybody's VPS.

## Before anything leaves your machine

All four, and read the output rather than the exit code:

```bash
npm run build          # first — it writes .next/types, which tsc reads
npx tsc --noEmit
npx eslint .
npx vitest run
```

`npm run build` is not optional, and it goes first: Next writes the typed-route
definitions into `.next/types` during a build, so `tsc` on an unbuilt checkout
fails on every route file for reasons that have nothing to do with your change
(B100). The deploy script builds **on the server**
before it restarts, so a build that fails there leaves the old site running and
the deploy simply fails — but it fails at 2am, over a hostel connection, on a
laptop that is about to lose power. Find it here instead.

Also boot the dev server with the capabilities you touched both **on and off**.
"Absent, not broken, when disabled" is a rule, and it is the one that breaks
quietly.

## Deploying

```bash
git push
ssh <host>
cd /srv/fernscout && ./scripts/deploy.sh
```

`scripts/deploy.sh` pulls, then runs **only the steps the diff asks for**:

1. `git pull --ff-only` — no merge commits happen on the server.
2. `npm ci` — when `package-lock.json` or `package.json` changed. The exact
   lockfile, never `npm install`.
3. `scripts/sync-shipped-content.sh` — when `content/locales/` or
   `content/rates/` changed (B56).
4. `npm run db:migrate` — when a migration, `lib/db/migrate.ts` or
   `lib/db/schema.ts` changed, and only when `DATABASE_URL` is set. Unset is
   supported and means a public-only site.
5. `npm run build` — for anything under `app/`, `lib/`, `components/`,
   `public/`, config, or any path the classifier does not recognise.
   **Before** the restart, on purpose.
6. `scripts/install-units.sh` — when a `deploy/*.service` or `*.timer` changed.
7. `systemctl restart fernscout` (and the worker, if it is enabled).
8. Polls `/api/health` for 30 seconds and fails loudly if it never goes green.

So a deploy carrying only task files or docs takes about three seconds and
builds nothing, and a code deploy skips `npm ci`. The plan is printed before
anything runs; the full table is in `docs/runbook.md`.

```bash
sudo ./scripts/deploy.sh --full          # every step, whatever changed
./scripts/deploy.sh --plan lib/foo.ts    # what those paths would cost, no server needed
```

What makes that safe is `$APP_DIR/.deploy-state`: the commit the script last
brought up **healthy**. It moves only after health goes green, so a failed
build re-plans from the commit that is actually serving. Delete it to force one
full deploy.

Two consequences worth knowing:

- **A deploy that skipped the restart leaves `/api/health` reporting the
  commit its build came from**, not `HEAD`. That is the honest answer — the old
  build is what is serving — and the script says so rather than leaving you to
  wonder.
- **Editing `scripts/deploy.sh` itself takes two deploys.** The running script
  pulls its own replacement partway through and bash reads a script
  incrementally, so the new behaviour appears on the next run. Judge the second
  one.

Overridable by environment: `APP_DIR` (default `/srv/fernscout`), `SERVICE`
(`fernscout`), `PORT` (`3000`), `STATE_FILE` (`$APP_DIR/.deploy-state`).

## Confirming it, from outside

```bash
curl -s https://<domain>/api/health | jq
```

`status: "ok"` and, more usefully, the `capabilities` block: every optional
feature reports whether it is on and — when it is not — **why**, without ever
printing a secret value. That block is the answer to "I enabled mail and
nothing happened".

`503` means config failed to resolve. Check `content/config.json` first.

## When it does not come up

```bash
journalctl -u fernscout -n 50 --no-pager
systemctl status fernscout
```

The usual causes, in order of likelihood:

| Symptom | Cause |
| --- | --- |
| Health never goes green | Build succeeded, boot failed — read `journalctl` |
| A capability is off after enabling it | Missing env var; `/api/health` names it |
| `503` from health | `content/config.json` did not parse |
| TLS fails on a new domain | DNS does not resolve yet; Caddy needs port 80 |
| Migrations "did nothing" | `DATABASE_URL` is unset — that is supported, not a bug |

Nothing here is fixed by re-running the deploy. Read the log first.

## Secrets

Every secret on the machine lives in `/etc/fernscout/env`, mode `640`, owned by
root and readable by the service group. **Never** in `content/config.json`,
never in the repository, never in a commit message, and never echoed back into
a chat. If you need a new one, add the name to `.env.example` with an empty
value and tell the author to set it on the server.

## Backups, before a risky deploy

```bash
sudo systemctl start fernscout-backup   # restic; reads the output, don't assume
```

Backs up the Postgres dump (when the dialect is Postgres), `$DATA_DIR` — which
includes the SQLite file — and `content/`. `content/` is the part that cannot be
regenerated: it is the journal.
