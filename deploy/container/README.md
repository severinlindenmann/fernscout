# Fernscout in containers (Kiri)

A second way to run an instance, beside `scripts/deploy.sh` on a plain VPS:
one image for the app, the official Postgres 17 image for the database, and
the host's own Caddy in front. Kiri is the engine it was written for; any
docker-compatible CLI works (`CONTAINER_ENGINE=docker`).

| File | What it is |
|---|---|
| `Containerfile` | Multi-stage build: deps, `next build`, a slim runtime as uid 10001 with ffmpeg, heif-convert, pg_dump 17, restic |
| `compose.yaml` | `app` (published on `127.0.0.1` only) and `db` (no port), data folder bind-mounted at its host path |
| `job.sh` | Runs a job (backup, photobook reconcile, any npm script) in a one-off container of the app |
| `systemd/` | Host timers that call `job.sh`; they replace `fernscout-backup.*` and `fernscout-reconcile.*` |
| `../../.dockerignore` | Keeps `node_modules`, `.next`, real content and env files out of the build; keeps `paid/` |

## What lives on the host, outside git

```
/etc/fernscout/env           the app's environment, same names as today
/etc/fernscout/db.env        POSTGRES_PASSWORD=...
/etc/fernscout/compose.env   NEXT_PUBLIC_SITE_URL, GIT_SHA, FERNSCOUT_DATA, FERNSCOUT_HOST_PORT, ...
/var/lib/fernscout/          data (content, home, mail, rates, staging, config.json), owned by 10001:10001
/var/backups/fernscout/      what backup.sh stages before restic ships it
```

Two values in `/etc/fernscout/env` differ from the non-container deploy:

- `DATABASE_URL=postgres://fernscout:<password>@db:5432/fernscout` (host `db`, the compose service).
- `PORT` is ignored; the app listens on 3000 inside, `FERNSCOUT_HOST_PORT` picks the host port.

`MAPS_DIR` is left unset once the maps provider replaces the local tiles.

## Build and start

From the repository root, with `paid/` uploaded beside the checkout for the
operator's own instance (it is built in when present; set
`FERNSCOUT_REQUIRE_PAID=1` in `compose.env` to make its absence fail the build):

```bash
export GIT_SHA=$(git rev-parse HEAD)
kiri compose -f deploy/container/compose.yaml --env-file /etc/fernscout/compose.env up -d --build
kiri compose -f deploy/container/compose.yaml ps
curl -fsS http://127.0.0.1:3000/api/health
```

The app migrates its database on start (`instrumentation.ts`). Caddy keeps
`import /srv/fernscout/deploy/fernscout.caddy`, which proxies to
`127.0.0.1:{$PORT:3000}` exactly as before.

A second instance (dev.fernscout.ch) is the same compose file under another
project name and env: `FERNSCOUT_PROJECT=fernscout-dev`,
`FERNSCOUT_DATA=/var/lib/fernscout-dev`, `FERNSCOUT_HOST_PORT=3001`,
`FERNSCOUT_ENV_FILE=/etc/fernscout/dev.env`, `FERNSCOUT_DB_ENV_FILE=/etc/fernscout/dev-db.env`,
`NEXT_PUBLIC_SITE_URL=https://dev.fernscout.ch`. It builds its own image
because the site URL is inlined into the client bundle.

## Jobs and timers

```bash
sudo cp deploy/container/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fernscout-container-backup.timer fernscout-container-reconcile.timer
deploy/container/job.sh backup                     # one backup now
deploy/container/job.sh db:status                  # any npm script
```

`scripts/alert.sh` runs inside the container, where `systemctl` and
`journalctl` are absent: the failure mail still goes out, without the unit's
exit status and log tail. The admin log page (`lib/adminLogs.ts`) reads
`journalctl` and shows nothing in a container; `kiri compose logs app` is the
log.

## Database dump and restore

```bash
kiri compose -f deploy/container/compose.yaml exec -T db pg_dump -U fernscout -Fc fernscout > fernscout.dump
kiri compose -f deploy/container/compose.yaml exec -T db pg_restore -U fernscout -d fernscout --clean --if-exists --no-owner < fernscout.dump
```
