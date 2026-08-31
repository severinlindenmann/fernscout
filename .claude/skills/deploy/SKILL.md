---
name: deploy
description: Ship Fernscout to the VPS and confirm it is actually healthy — verify locally, push, run scripts/deploy.sh, check /api/health. Use when the user says "deploy", "ship it", "push it live", "release", or asks why the live site is not showing a change.
---

# Deploy

A deploy is a pull, an install, a build and a restart, run on the machine that
serves. There is no image and no artifact to ship — that is why there is no
Docker here. Full reference: `docs/runbook.md`.

## Before anything leaves your machine

All four, and read the output rather than the exit code:

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```

`npm run build` is not optional. The deploy script builds **on the server**
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
cd /srv/reisepost && ./scripts/deploy.sh
```

`scripts/deploy.sh` does, in this order:

1. `git pull --ff-only` — no merge commits happen on the server.
2. `npm ci` — the exact lockfile, never `npm install`.
3. `npm run db:migrate`, only when `DATABASE_URL` is set. Unset is supported
   and means a public-only site.
4. `npm run build` — **before** the restart, on purpose.
5. `systemctl restart reisepost` (and the worker, if it is enabled).
6. Polls `/api/health` for 30 seconds and fails loudly if it never goes green.

Overridable by environment: `APP_DIR` (default `/srv/reisepost`), `SERVICE`
(`reisepost`), `PORT` (`3000`).

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
journalctl -u reisepost -n 50 --no-pager
systemctl status reisepost
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

Every secret on the machine lives in `/etc/reisepost/env`, mode `640`, owned by
root and readable by the service group. **Never** in `content/config.json`,
never in the repository, never in a commit message, and never echoed back into
a chat. If you need a new one, add the name to `.env.example` with an empty
value and tell the author to set it on the server.

## Backups, before a risky deploy

```bash
sudo systemctl start reisepost-backup   # restic; reads the output, don't assume
```

Backs up the Postgres dump (when the dialect is Postgres), `$DATA_DIR` — which
includes the SQLite file — and `content/`. `content/` is the part that cannot be
regenerated: it is the journal.
