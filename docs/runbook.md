# Runbook

Deploying and operating Fernscout on a plain VPS. No containers: packages, a
systemd unit, and a deploy script.

## Contents

- [What actually runs](#what-actually-runs)
- [First deploy on a fresh VPS](#first-deploy-on-a-fresh-vps)
- [Day-to-day deploys](#day-to-day-deploys)
- [Deploying alongside an existing Caddy site](#deploying-alongside-an-existing-caddy-site)
- [Adding Postgres later](#adding-postgres-later)
- [`/api/health`](#apihealth)
- [Backups](#backups)
- [Restore procedure](#restore-procedure)
- [Troubleshooting](#troubleshooting)

> This is the VPS. For a production build on your own machine — which is where
> a deploy should be rehearsed — see [running-locally.md](running-locally.md).

---

> **Renamed from Reisepost, 2026-08-30.** Every deployment name changed with
> it — the unix user, `/srv/fernscout`, `/var/lib/fernscout`,
> `/etc/fernscout/env`, the systemd units, the SQLite filename, the Postgres
> role and the restic tag.
>
> That was safe to do wholesale **because there is no live instance yet**: no
> domain in DNS, no VPS provisioned, no restic snapshots to orphan and no
> Postgres role in existence. Renaming after a first deploy costs a data
> migration and a deliberate `restic forget` against the old tag; renaming
> before one costs nothing. It was done now for exactly that reason.

## What actually runs

Four things, and two of them are optional.

| | What | Needed for |
| --- | --- | --- |
| **Node** | The Next.js server — API routes, server rendering, the data layer | always |
| **Caddy** | TLS and reverse proxy, automatic Let's Encrypt | always |
| Postgres | Accounts, contacts, sessions, jobs | only once `auth`, `contacts` or `postcards` are on |
| Worker | Background jobs — digests, push, print rendering | only once something enqueues work |

**The public site needs the first two.** That is the prototype tier
(ROADMAP §2.2), and it is not a stripped-down mode — it is the same app with
the flags off.

---

## First deploy on a fresh VPS

Debian or Ubuntu. Substitute your domain throughout.

### 1. A user to run as

```bash
sudo adduser --system --group --home /srv/fernscout fernscout
sudo mkdir -p /var/lib/fernscout /etc/fernscout
sudo chown fernscout:fernscout /var/lib/fernscout
```

### 2. Node

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git build-essential python3
node -v            # expect v24.x
```

`build-essential` and `python3` are for node-gyp: `better-sqlite3` compiles
from source, and `package.json`'s `allowScripts` block means `npm ci` actually
runs that build rather than skipping it. A Postgres deployment never loads the
module — `lib/db/client.ts` imports it lazily — but `npm ci` still fails
outright if it cannot be built.

### 3. Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 4. The app

```bash
sudo -u fernscout git clone https://github.com/severinlindenmann/fernscout.git /srv/fernscout
cd /srv/fernscout
sudo -u fernscout npm ci
```

### 5. Environment

```bash
sudo cp .env.example /etc/fernscout/env
sudo chmod 640 /etc/fernscout/env
sudo chown root:fernscout /etc/fernscout/env
sudo nano /etc/fernscout/env
```

At minimum set `NEXT_PUBLIC_SITE_URL` and `DATA_DIR=/var/lib/fernscout`.
Leave `DATABASE_URL` unset for a public-only site.

Set `CONTENT_DIR=/var/lib/fernscout/content` too, and seed it once:

```bash
sudo -u fernscout mkdir -p /var/lib/fernscout/content
sudo -u fernscout cp -a /srv/fernscout/content/. /var/lib/fernscout/content/
```

The journal then lives outside the repository, which matters for two reasons
that only show up later. `scripts/deploy.sh` runs `git pull --ff-only`, and an
agent writing a draft over `/api/v1` or `/api/mcp` writes into that same
working tree — the next deploy fails on local modifications. And the config
that switches on `mail` and `auth` belongs to *this* machine, where the
credentials are; committed to the repository it would fail the boot check
(`instrumentation.ts` → `assertCapabilities`) for everyone who cloned it.

`content/locales/` still resolves from the repo when the content folder has no
copy of its own (`lib/locales.ts`), so a UI translation added upstream arrives
with the next deploy either way.

> `/etc/fernscout/env` holds every secret on the machine. Mode `640`,
> owned by root, readable by the service group — never world-readable, and
> never inside the repo.

### 6. Build and start

```bash
sudo -u fernscout npm run build
sudo cp deploy/fernscout.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fernscout
systemctl status fernscout
curl -s localhost:3000/api/health | head
```

### 7. TLS

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # set your domain and ACME email
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

> **Only on a machine that serves nothing else.** Caddy has exactly one config
> file, shared by everything on the host, so that `cp` deletes any site already
> configured there. If `/etc/caddy/Caddyfile` already has content, see
> [Deploying alongside an existing Caddy site](#deploying-alongside-an-existing-caddy-site).

`caddy validate` before the reload, always: a reload of a broken config leaves
the old one running, but a *restart* of one does not, and the difference is
easy to discover the wrong way round.

Point the domain's A/AAAA records at the VPS **before** reloading — Caddy
requests the certificate over HTTP on port 80 and needs the name to resolve.

```bash
curl -sI https://<your-domain>/api/health | head -1
```

---

## Day-to-day deploys

```bash
cd /srv/fernscout && ./scripts/deploy.sh
```

Pull, `npm ci`, migrate if a database is configured, build, restart, wait for
health. **The build runs before the restart**, so a broken build leaves the
running site untouched instead of taking it down and then failing.

---

## Deploying alongside an existing Caddy site

A VPS that already serves something is the normal case, not the exception.
Nothing about the deploy changes except step 7 — but that step, run as written,
takes the other site down.

**Back the file up before touching it**, then append a site block, leaving
every existing block byte-identical:

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)
sudo tee -a /etc/caddy/Caddyfile >/dev/null <<'EOF'

fernscout.ch {
	encode gzip zstd
	reverse_proxy 127.0.0.1:3000
}

www.fernscout.ch {
	redir https://fernscout.ch{uri} permanent
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Two things not to do. Do not add a second global options block — the `{ email }`
block at the top of `deploy/Caddyfile` is a config error when one already
exists, and adding one where there was none changes ACME behaviour for the
sites already being served; Caddy's default account is already issuing their
certificates. And `reload`, never `restart`: a reload swaps the config with no
dropped connection, so the neighbouring site does not so much as blink.

Check the neighbour before and after, not just your own site:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://the-other-site.example
```

Port 3000 must also be free. `sudo ss -tlnp | grep :3000` before you start;
if something else holds it, set `PORT` in `/etc/fernscout/env` and match it in
the `reverse_proxy` line.

---

## Adding Postgres later

Nothing needs rebuilding; the data layer picks its dialect from `DATABASE_URL`.

```bash
sudo apt install -y postgresql
sudo -u postgres createuser fernscout --pwprompt
sudo -u postgres createdb fernscout -O fernscout
```

Add to `/etc/fernscout/env`:

```
DATABASE_URL=postgres://fernscout:<password>@localhost:5432/fernscout
```

Then:

```bash
cd /srv/fernscout
sudo -u fernscout npm run db:migrate
sudo -u fernscout npm run db:import     # moves existing JSON state into the DB
sudo systemctl restart fernscout
```

`/api/health` should now report the database-backed capabilities as available.

---

## `/api/health`

```json
{
  "status": "ok",
  "uptimeSeconds": 1,
  "config": { "ok": true },
  "capabilities": {
    "push": { "enabled": false, "reason": "disabled in config.json" },
    "mail": { "enabled": false, "reason": "disabled in config.json" }
  }
}
```

Every capability reports whether it is on and, if not, why — **never a secret
value**. `503` means config failed to resolve. Point an uptime monitor at it:
while travelling, you cannot debug what you cannot see.

---

## Backups

`scripts/backup.sh`, driven by `deploy/fernscout-backup.timer` (nightly, 03:20
with a randomised delay).

```bash
sudo apt install -y restic
sudo cp deploy/fernscout-backup.service deploy/fernscout-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fernscout-backup.timer
systemctl list-timers fernscout-backup
```

Set `RESTIC_REPOSITORY` and `RESTIC_PASSWORD` in `/etc/fernscout/env`.

**Contents:** the Postgres dump (only when `DATABASE_URL` is `postgres://…`),
`$DATA_DIR` (which includes the SQLite file if that is the dialect), and
`content/`.

**Run one now, and read the output:**

```bash
sudo systemctl start fernscout-backup
journalctl -u fernscout-backup -n 30
```

> Losing `RESTIC_PASSWORD` loses the backups. It is not recoverable. Store it
> somewhere that is not this machine.

---

## Restore procedure

```bash
# 0. Fresh machine: steps 1–5 of "First deploy", with the same
#    RESTIC_REPOSITORY / RESTIC_PASSWORD.

# 1. Restore the latest snapshot to a scratch directory.
sudo restic restore latest --target /restore

# 2. The tree keeps its original absolute path — find it once.
STAGED=$(sudo find /restore -maxdepth 4 -type d -name 'fernscout-backup-staging' | head -1)

# 3. Database (skip if this deployment has none).
sudo -u postgres createdb fernscout -O fernscout
sudo -u fernscout pg_restore --dbname="$DATABASE_URL" --clean --if-exists \
  "$STAGED/db/postgres.dump"

# 4. DATA_DIR and content/.
sudo rsync -a "$STAGED/data/"    /var/lib/fernscout/
sudo rsync -a "$STAGED/content/" /srv/fernscout/content/
sudo chown -R fernscout:fernscout /var/lib/fernscout /srv/fernscout/content

# 5. Build and start.
cd /srv/fernscout && sudo -u fernscout npm ci && sudo -u fernscout npm run build
sudo systemctl restart fernscout

# 6. Verify: health, then a known reaction count on a known day.
curl -s https://<domain>/api/health
```

### Restore drill — executed and timed

A drill was run against the previous containerised layout: real Postgres rows
plus file state seeded, backed up, destroyed, restored. **Postgres rows came
back exact and files byte-identical, in 46 seconds.** The mechanism —
`pg_dump -Fc` into restic, restored with `pg_restore` — is unchanged here; only
*where* `pg_dump` runs changed, from inside a container to the host.

- [ ] **Re-run the drill on the native stack before relying on it.** The
      procedure above is derived, not yet executed end to end. A backup you
      have not restored from is not a backup, and a *procedure* you have not
      followed is not a procedure.

---

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| Service won't start | `journalctl -u fernscout -n 50`. A capability enabled without its credentials **fails the boot on purpose**, naming the flag and the variable. |
| TLS not issued | `journalctl -u caddy -n 50`. Almost always DNS not resolving to this host yet, or port 80 blocked. |
| Site up, features missing | `curl -s localhost:3000/api/health` — each capability states why it is off. |
| Reactions vanished after adding a database | `npm run db:import` moves the JSON state in. It is idempotent. |
| Deploy failed mid-build | The old process is still serving. Fix, re-run `./scripts/deploy.sh`. |
