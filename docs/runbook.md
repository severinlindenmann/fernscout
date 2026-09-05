# Runbook

Deploying and operating Fernscout on a plain VPS. No containers: packages, a
systemd unit, and a deploy script.

## Contents

- [What actually runs](#what-actually-runs)
- [First deploy on a fresh VPS](#first-deploy-on-a-fresh-vps)
- [Day-to-day deploys](#day-to-day-deploys)
- [Deploying alongside an existing Caddy site](#deploying-alongside-an-existing-caddy-site)
- [Adding Postgres later](#adding-postgres-later)
- [What the first deploy turned up](#what-the-first-deploy-turned-up)
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

Set `CONTENT_DIR=/var/lib/fernscout/content` too, and seed it once.

**`content/` is two things with two lifecycles**, and the seeding step is only
about one of them:

| | | |
| --- | --- | --- |
| **Shipped with the code** | `locales/`, `rates/` | belongs to the release; every deploy replaces it |
| **Owned by the operator** | `config.json`, `<username>/` | belongs to this machine; no deploy ever touches it |

Seed the operator's half by hand — this instance's config and its journals —
and let the deploy put the shipped half there:

```bash
sudo -u fernscout mkdir -p /var/lib/fernscout/content
# The operator's half: this machine's config, and the journals on it.
sudo -u fernscout cp -a /srv/fernscout/content/config.json /var/lib/fernscout/content/
sudo -u fernscout cp -a /srv/fernscout/content/example /var/lib/fernscout/content/
# The shipped half. Every deploy repeats exactly this — see "Day-to-day deploys".
sudo -u fernscout env CONTENT_DIR=/var/lib/fernscout/content \
  /srv/fernscout/scripts/sync-shipped-content.sh
```

> **Do not hand-edit `locales/` under `CONTENT_DIR`.** `lib/locales.ts` reads
> the shipped dictionary first and then merges the content folder's on top, key
> by key, so a copy taken at install time wins for every string it holds, for
> ever — a wording fix shipped six months later silently does not appear, and
> the only clue is that the site disagrees with the repository. That is what
> B56 was: fernscout.ch served August's German for as long as it was up.
>
> The deploy now replaces `locales/` and `rates/` from the repository on every
> run, which is what keeps them honest. An instance that really does want its
> own wording keeps a file with *only* the keys it is changing **and** puts an
> empty `.keep-local` file next to it — `scripts/sync-shipped-content.sh` then
> leaves that directory alone and says so in its output. Without the marker,
> local edits there are overwritten by design.

The journal then lives outside the repository, which matters for two reasons
that only show up later. `scripts/deploy.sh` runs `git pull --ff-only`, and an
agent writing a draft over `/api/v1` writes into that same working tree — the
next deploy fails on local modifications. And the config
that switches on `mail` and `auth` belongs to *this* machine, where the
credentials are; committed to the repository it would fail the boot check
(`instrumentation.ts` → `assertCapabilities`) for everyone who cloned it.

`content/locales/` also resolves from the repo when the content folder has no
copy of its own (`lib/locales.ts`), so a fresh instance renders in English
before the first sync rather than rendering nothing.

> `/etc/fernscout/env` holds every secret on the machine. Mode `640`,
> owned by root, readable by the service group — never world-readable, and
> never inside the repo.

### 6. Build and start

```bash
sudo -u fernscout npm run build
sudo ./scripts/install-units.sh          # every unit in deploy/, + daemon-reload
sudo systemctl enable --now fernscout
systemctl status fernscout
curl -s localhost:3000/api/health | head
```

`install-units.sh` copies every `.service` and `.timer` in `deploy/` into
`/etc/systemd/system` and reloads. It **does not enable anything** — that line
above is yours, and stays yours, because `fernscout-worker.service` ships
disabled on purpose. Every later deploy runs the same script, so from here on a
unit change reaches the machine with the commit that made it (B138). It is not
Caddy's config — Caddy has one file for the whole machine and a deploy has no
business writing it. The proxy keeps up a different way, by importing a file
inside the checkout; see §TLS, and
[Does the running proxy still match the release?](#does-the-running-proxy-still-match-the-release)
for the check that says whether it did (B66).

### 7. TLS

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # set your ACME email; check the import path
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

> **Only on a machine that serves nothing else.** Caddy has exactly one config
> file, shared by everything on the host, so that `cp` deletes any site already
> configured there. If `/etc/caddy/Caddyfile` already has content, see
> [Deploying alongside an existing Caddy site](#deploying-alongside-an-existing-caddy-site).

`deploy/Caddyfile` is a global options block and **one `import` line**. The
site block itself is `deploy/fernscout.caddy`, inside the checkout, and Caddy
reads it from there — so a proxy directive added in a later release arrives
with `git pull`, on this machine and on a shared one, and the file you edited
by hand is never the file that got left behind (B66). Adjust the import path
if the checkout is not at `/srv/fernscout`; leave the rest alone.

**Do not edit `deploy/fernscout.caddy`.** It is the release's, and the next
`git pull` will conflict with anything written into it. The two values it needs
come from Caddy's own environment:

```bash
sudo systemctl edit caddy
# [Service]
# Environment=CADDY_DOMAIN=your-domain.example
# Environment=CADDY_ACME_EMAIL=you@your-domain.example
sudo systemctl daemon-reload
sudo CADDY_DOMAIN=your-domain.example CADDY_ACME_EMAIL=you@your-domain.example \
  caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The upstream port is `{$PORT:3000}`, so a deployment that moved the app off
3000 sets `PORT` in `/etc/fernscout/env` **and** adds `Environment=PORT=…` to
that same drop-in — Caddy expands the placeholder from its own environment, not
from the app's. Still no proxy edit.

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
cd /srv/fernscout && sudo ./scripts/deploy.sh
```

Pull, then **only the steps the diff needs** — install, migrate, sync, build,
units, restart — and wait for health. **The build runs before the restart**, so
a broken build leaves the running site untouched instead of taking it down and
then failing.

### Which steps run (B258)

The deploy compares the commit it last brought up healthy against what it just
pulled, and asks each changed path what it costs:

| Changed | Adds |
| --- | --- |
| `docs/`, `test/`, `scripts/`, `.claude/`, `.github/`, root `*.md`, tooling config | nothing |
| `content/locales/`, `content/rates/` | sync, build, restart |
| other `content/` | nothing, and it says so — a deploy does not copy that half |
| `app/`, `lib/`, `components/`, `public/`, `next.config.ts`, **anything unrecognised** | build, restart |
| `package.json`, `package-lock.json` | `npm ci` |
| `lib/db/migrations/`, `lib/db/migrate.ts`, `lib/db/schema.ts` | `npm run db:migrate` |
| `deploy/*.service`, `*.timer` | `scripts/install-units.sh` |
| `deploy/*.caddy`, `deploy/Caddyfile` | the Caddy drift report |

A deploy that carries only task files therefore takes about three seconds, and
a code-only deploy skips the `npm ci` that used to rewrite `node_modules`
against a lockfile it already had. The plan is printed before anything runs.

An unrecognised path builds rather than doing nothing, deliberately: a
directory added next year is code until somebody says otherwise, because
guessing "code" wrongly costs a build nobody needed and guessing "prose"
wrongly serves the previous release under a green health check.

```bash
sudo ./scripts/deploy.sh --full          # every step, whatever changed
./scripts/deploy.sh --plan lib/foo.ts    # what those paths would cost, and exit
```

`--plan` touches nothing and needs no server; `test/deploy-plan.test.ts` is
that mode held to the table above.

Six things it does that are not obvious from the name:

- **It syncs the shipped half of `content/` into `CONTENT_DIR`** —
  `scripts/sync-shipped-content.sh`, run after the pull and before the build.
  `git pull` updates `/srv/fernscout/content`, the app reads
  `/var/lib/fernscout/content`, and until B56 nothing crossed the gap: every
  string added or reworded since the machine was set up was invisible, and
  three strings *deleted* from the repository were still being served. It
  replaces `locales/` and `rates/` rather than merging into them, so a deleted
  key actually disappears, and it refuses to write anywhere else — a deploy
  that could overwrite `<username>/` is a worse bug than the one it fixes.
- **It reads `/etc/fernscout/env` itself.** A root shell has no `DATABASE_URL`,
  and without this the migration step takes its "running without a database
  (supported)" branch on a deployment that has had Postgres since its first
  boot — a skipped migration that announces itself as a design decision.
- **It steps down to the `fernscout` user** for the pull, the install and the
  build, and uses `sudo` only for the restart. Building as root leaves
  root-owned files in `.next/` and `node_modules/`, under a service that is not
  root and needs to write its own build cache. If that has already happened:
  `sudo chown -R fernscout:fernscout /srv/fernscout`.
- **It installs the systemd units** — `scripts/install-units.sh`, after the
  build and before the restart. Any `.service` or `.timer` in `deploy/` that
  differs from what is on the machine is copied over and reloaded, changed
  timers are re-armed, and nothing is enabled or disabled. If it cannot write
  `/etc/systemd/system` the deploy **fails**, naming the file — a deploy that
  left a unit change behind used to be indistinguishable from one that had
  none, which is the whole of B138.
- **It records `GIT_SHA`** in a systemd drop-in, so `/api/health` answers
  "which build is actually running" rather than `"commit": null`. Only when it
  restarts: a drop-in written without one would relabel the running build with
  a commit it was not built from at the next reboot, and a version label that
  lies is worse than one that lags. After a deploy that changed only prose,
  `/api/health` still names the commit the running build came from — which is
  the true answer, and the script says so.
- **It remembers what it last brought up healthy**, in
  `/srv/fernscout/.deploy-state`. That marker is what makes the table above
  safe: it moves only *after* health goes green, so a build that fails leaves
  it pointing at the commit that is actually serving and the next attempt
  re-plans from there rather than from the one it never managed to run. Delete
  it and the next deploy does everything once. It is also robust to a `git
  pull` somebody ran by hand — the diff is taken from the last healthy commit,
  not from the pull.

**Check the shipped content actually arrived**, rather than reading the log and
believing it. Both commands are silent on success:

```bash
# The dictionaries and the rates the site is serving are the ones in the repo.
sudo diff -r /srv/fernscout/content/locales /var/lib/fernscout/content/locales
sudo diff -r /srv/fernscout/content/rates   /var/lib/fernscout/content/rates
```

And the other half is still the operator's — nothing a deploy wrote:

```bash
# Run before and after a deploy; the two lines must be identical.
sudo find /var/lib/fernscout/content \
  \( -path '*/content/locales' -o -path '*/content/rates' \) -prune \
  -o -type f -print0 | sudo xargs -0 sha256sum | sort | sha256sum
```

> **Editing `scripts/deploy.sh` itself?** The running script pulls its own
> replacement partway through, and bash reads a script incrementally — so the
> deploy that lands a change to this file is still the *old* script, and the
> new behaviour only appears on the next run. Deploy twice, and judge the
> second one.

> **Deploying a change to the user config shape?** `content/` lives outside
> the repository — `git pull` never touches it — so a branch that changes what
> `content/<username>/config.json` must look like (W37's `owner:`, for
> instance) needs the content files migrated **before** the code that requires
> the new shape ships, never after. Deploying first leaves every journal whose
> config the parser now rejects stuck on the old shape until someone notices
> and fixes it by hand, on a live site.
>
> That failure is quiet on purpose from the parser's point of view, and quiet
> by accident from the operator's: `getUser` catches the `ConfigError`, logs a
> warning and returns `null`, so the journal just 404s — `/api/health` reports
> nothing wrong, because config resolution for the *server* still succeeds.
> An uptime monitor watching `/api/health` will not catch this.
>
> Check `journalctl -u fernscout` for `config.json is unusable` after any
> deploy that touched config parsing, and see
> [`docs/config-upgrades.md`](config-upgrades.md) — most such changes ship a
> `scripts/migrate-*.ts` to run against `/var/lib/fernscout/content` first. A
> non-zero exit from one of those scripts means at least one journal needs
> attention — it does not mean nothing was written; re-running is safe.

---

## Deploying alongside an existing Caddy site

A VPS that already serves something is the normal case, not the exception.
Nothing about the deploy changes except step 7 — but that step, run as written,
takes the other site down.

**Back the file up before touching it**, then append **one line**, leaving
every existing block byte-identical:

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)
sudo tee -a /etc/caddy/Caddyfile >/dev/null <<'EOF'

import /srv/fernscout/deploy/fernscout.caddy
EOF
sudo systemctl edit caddy      # Environment=CADDY_DOMAIN=… (see §7)
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

**That line is the whole of it, and it is the point.** The site block it pulls
in lives in the checkout, so every later release's proxy changes arrive with
`git pull` — no second merge, ever. Copying the block in by hand instead still
works and still serves the site, and it is how B01's `header_up
X-Forwarded-For` came to be deployed, reported healthy, and completely absent
from the running proxy for a day: a fix that only exists in a template is not
deployed, it is written down.

Two things not to do. Do not add a second global options block — the `{ email }`
block at the top of `deploy/Caddyfile` is a config error when one already
exists, and adding one where there was none changes ACME behaviour for the
sites already being served; Caddy's default account is already issuing their
certificates. That block is why the import exists as a separate file: it is the
one part of `deploy/Caddyfile` a shared host must not take. And `reload`, never
`restart`: a reload swaps the config with no dropped connection, so the
neighbouring site does not so much as blink.

### Does the running proxy still match the release?

```bash
cd /srv/fernscout && npm run check:caddy
```

It adapts `/etc/caddy/Caddyfile` and `deploy/fernscout.caddy` through
`caddy adapt` and reports any directive the release expects and the machine is
not serving — by name, with the import line that fixes it for good. Extra
directives of your own are not drift and are not reported; only ours going
missing is. `scripts/deploy.sh` runs it at the end of every deploy and prints
the answer, so an operator who declined the import is told each time rather
than a year later. Exit 0 agrees, 1 drifted, 2 could not be checked (no Caddy
on this machine, which is a supported deployment).

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

## What the first deploy turned up

Recorded because none of it is visible from a clean checkout, and all of it
cost time on the day (2026-08-31, the first deployment to fernscout.ch).

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm ci` "succeeds" but `next: command not found` | npm ≥ 11.19 blocks install scripts unless `package.json` lists them under `allowScripts`; esbuild's postinstall never ran, so `tsx` was broken and `db:migrate` with it | The `allowScripts` block is committed. `npm install-scripts ls` must say "no packages with unreviewed install scripts" |
| `npm ci` fails on `better-sqlite3` | node-gyp has no toolchain | `apt install build-essential python3` |
| Untracked `.npm/`, `.cache/`, `.config/` appear in the repo | The service user's home *was* the repo root, so npm cached into it | `usermod -d /var/lib/fernscout/home fernscout` |
| Migrations skipped, cheerfully | `deploy.sh` did not read `/etc/fernscout/env` | Fixed in the script; see above |
| `git` refuses the repo halfway through a deploy | `HOME` is repointed at the service user by then, so root's `safe.directory` exception is in the wrong config file | Every git call in the script runs as the service user |
| Port 3000 answering on the public IP | `next start` binds `0.0.0.0` by default | `--hostname 127.0.0.1` in the unit. `HOSTNAME=` in the environment does **not** do this — `next start` takes the flag |
| Auth returns 500, log says "SMTP transport is not implemented" | It genuinely was not, until 2026-08-31 | Implemented in `lib/mail/smtp.ts`; see [deploy-mail.md](deploy-mail.md) |

One thing was left undone rather than fixed: **there are no backups**, by
decision and not by omission. See [Backups](#backups).

The certificate step, by contrast, was uneventful: DNS already pointed at the
host, so Caddy issued for `fernscout.ch` and `www.fernscout.ch` within seconds
of the reload, and the neighbouring site never noticed.

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

### What it says to a stranger, and what it says to you

It is unauthenticated, and stays that way — a monitor cannot hold a credential.
So the *state* is public and the *detail* is not (B234):

| Public, to anybody | Needs `HEALTH_TOKEN` |
| --- | --- |
| `status`, `time`, `uptimeSeconds`, `version`, `commit`, `backup`, `responseTimeMs` | — |
| `config`/`content`/`basemap`: `ok` and a machine-readable `code` | their free-text `error`, which carries the absolute content path and the errno |
| `capabilities`, including each `reason` | — |
| `journals` for journals this instance advertises, plus `journalsWithheld` | `journals` rows for journals whose config says `visibility: private` |

```bash
curl -sH "Authorization: Bearer $HEALTH_TOKEN" localhost:3000/api/health | jq
```

Set it in `/etc/fernscout/env` (`openssl rand -hex 32`). Unset entitles nobody
rather than everybody, so an instance that never sets it serves the redacted
page — which still distinguishes "cannot read the content directory" from
"there are no journals", the thing B197 added the field for. The full message
is on stdout either way: `journalctl -u fernscout`.

### Request logging

Off by default. `features.logging.enabled: true` in `content/config.json`
turns it on, the same shape as every other capability here:

```json
{
  "features": {
    "logging": { "enabled": true }
  }
}
```

Once it is on, every request `proxy.ts` lets through writes one line to
stdout — `journalctl -u fernscout`, the same place every other problem here
gets read:

```
[request] GET /agent.md ua="AgentFetch/1.0 (+https://example.com/agent)"
```

**Method, path and user agent. Never an IP address, and never a query
string** (B257). This server holds private journals, so a log of
`/<user>/day/<slug>` sitting next to an address is already an identified
reading history. If an operator needs client addresses for abuse work, that
is a second, separately-named switch and a separate decision — not this one.

**Not a response log, on purpose rather than by omission.** `proxy.ts` runs
*before* a request completes — Next's own docs for `proxy` say exactly that —
so there is no status code, no duration and no response size in existence yet
at the point this line is written. Getting those three would mean a hook
inside every route handler instead of the one choke point this ticket chose,
which is the "a call per handler" it explicitly did not want. What is logged
is everything proxy actually has the moment it lets a request through.

**Retained for exactly as long as `journalctl` keeps it, and nowhere else** —
no file, no rotation, nothing under `CONTENT_DIR` or any journal's own
folder. Systemd already collects, rotates and expires this on the unit's own
terms; check what that is with `journalctl --disk-usage` and
`systemctl show systemd-journald -p SystemMaxUse -p MaxRetentionSec`. An
operator who needs a request kept longer than the journal does needs a
different mechanism than this switch.

`_next/static`, `_next/image` and `favicon.ico` stay excluded even with this
on — build assets served dozens of times per page view, and a log that is
mostly those lines is a log nobody reads. Everything else the matcher admits
is logged, including `/api/**` (every draft, publish and invite call — the
write side this whole ticket exists for) and the two agent-facing root
documents, `/agent.md` and `/documentation.txt`.

`scripts/deploy.sh` prints whether this is on, the same way it already prints
backup and Caddy state.

---

## Backups

> ### Not set up on fernscout.ch — superseded on 2026-09-01
>
> **This is history now.** restic, both units and the credentials were
> installed while preparing the restore drill below, and one verified snapshot
> exists. What is *not* yet written down is the repository's location and where
> the password is kept off-machine — that is the rest of B65. The block is left
> standing because the reasoning in it is still the right reasoning, and because
> "we knew we had none" is the part worth keeping.
>
> **Decided 2026-08-31, at the first deploy.** No off-VPS storage had been
> chosen yet, and a backup written to the machine it protects is not a backup.
> Rather than wire up something that looks like protection, nothing was
> installed: no `restic`, no units, no timer. Check it yourself with
> `systemctl list-timers | grep fernscout` — an empty result is the expected
> one, not a fault.
>
> The choice was to have no backups and *know* it, rather than have a timer
> that fails quietly into a journal nobody reads. The reason it is written
> here, in the operations doc, is that the second-worst outcome after losing
> the journal is being surprised that it was possible.
>
> **What is exposed meanwhile:** `/var/lib/fernscout/content` — the journal
> itself, and the only state on the host that cannot be rebuilt from git or by
> re-running a migration. Losing Postgres logs everybody out and drops the
> reaction counts; losing `content/` loses the trip.
>
> **Interim measure, if the real thing is still weeks away:** copy the content
> folder off the machine by hand and date it. It is 17 MB today.
>
> ```bash
> rsync -a --delete root@<host>:/var/lib/fernscout/content/ ~/fernscout-content-$(date +%F)/
> ```
>
> Everything below works and is `CONTENT_DIR`-aware. Turning it on needs two
> credentials and one `systemctl enable`; `/etc/fernscout/env` carries a
> commented block naming the variables.

`scripts/backup.sh`, driven by `deploy/fernscout-backup.timer` (nightly, 03:20
with a randomised delay).

```bash
sudo apt install -y restic
sudo ./scripts/install-units.sh                          # or just deploy
sudo systemctl enable --now fernscout-backup.timer
```

`fernscout-alert@.service` is not enabled and has no timer of its own — the
backup unit's `OnFailure=` starts it. It is not optional: without it a failed
backup goes to a journal and nowhere else, which is exactly how this server
managed three aborted nights in a row unnoticed.

Since B138 it arrives with the deploy rather than with a `cp` somebody has to
remember, which is the fix for how it went missing in the first place — B64
shipped the `OnFailure=` line and the handler together in one commit, and for
two days the server had neither. Check both landed:

```bash
systemctl show fernscout-backup.service -p OnFailure
systemctl cat 'fernscout-alert@fernscout-backup.service' | head -3
```

Set `RESTIC_REPOSITORY` and `RESTIC_PASSWORD` in `/etc/fernscout/env`, and
`BACKUP_ALERT_EMAIL` if the alert should go somewhere other than the default
journal's owner.

**Then initialise the repository, once, by hand.** The nightly run will not do
it for you, on purpose:

```bash
set -a; . /etc/fernscout/env; set +a
sudo -u fernscout -E restic init
```

A run that finds no repository **fails** rather than creating one, because the
two reasons it might find none are a genuine first run and a typo in
`RESTIC_REPOSITORY` — and the second used to make a brand new empty repository,
back into it, prune it and exit 0. A perfectly green backup protecting nothing,
while every real snapshot sat in the repository nobody was writing to any more
(B63). `BACKUP_INIT_IF_MISSING=1` allows it for one run if you would rather not
type `restic init`; do not put it in `/etc/fernscout/env`, where the timer would
read it every night.

The script also refuses to run `restic init` when it *cannot see* the
repository — permission denied, wrong password, storage unreachable — and says
which of the two it found. That is the case this server hit: the repository was
root-owned, the service runs as `fernscout`, and the old probe read
permission-denied as "not initialised yet".

Each run logs how many snapshots the repository holds, and warns when that is
one. A repository you believe holds a fortnight and which holds one is not the
repository you meant.

Two things the drill learned the hard way, both worth checking before the first
run: `RESTIC_REPOSITORY` must be under a path listed in the unit's
`ReadWritePaths=`, and the repository must be **owned by `fernscout`**, the
user the service runs as.

**Everything under `DATA_DIR` and `content/` must be readable by that same
user**, and a run that finds something it cannot read tells you so by name:

```
WARNING: 1 path(s) under DATA_DIR could not be staged and are NOT in tonight's snapshot:
WARNING:   /var/lib/fernscout/root-owned-stray.txt
ERROR: the snapshot was pushed, but 1 path(s) are missing from it — …
```

That run **does both things** (B114). It stages and pushes everything it could
read, because a night with no backup at all is the worse of the two failures
and the journal's originals exist nowhere else — the snapshot is real, and is
tagged `partial` so `restic snapshots` still says which nights were complete.
And it **exits non-zero anyway**: no `.backup-last-success` stamp, the
`OnFailure=` alert fires, `/api/health` reports `backup.state: "failing"`.
Skipping a file is tolerated; being told the backup was fine is not.

The fix is on the machine, not in the script: `chown fernscout:fernscout` (or
delete) each path the log names, and the next run is green again. Before this,
one root-owned stray file was enough to abort the whole run at `cp -a` with
`set -e`, before anything had been pushed — and the journal never said which
file it was.

### Is the backup working?

Not `systemctl list-timers`. That reports the schedule and never the result —
a timer whose every run has aborted since March still prints a healthy
next-elapse, and the runbook used to send people to it. Three that do answer
the question:

```bash
systemctl status fernscout-backup            # how the LAST run ended
cat /var/lib/fernscout/.backup-last-success  # when it last finished
curl -s https://<domain>/api/health | jq .backup
```

The third works from anywhere, needs no shell on the box, and is what an uptime
monitor should assert on:

```json
"backup": { "state": "ok", "lastSuccessAt": "2026-09-01T03:20:14.000Z",
            "ageHours": 9.4, "lastFailureAt": null, "maxAgeHours": 36 }
```

`state` is `ok`, `stale` (nothing succeeded within `BACKUP_MAX_AGE_HOURS`,
36 by default), `failing` (a run failed since the last success) or `unknown`
(nothing has ever succeeded in this `DATA_DIR` — the state an instance with no
backups at all reports, which is the point). Anything other than `ok` carries a
`reason`. It deliberately does **not** change the endpoint's status code: a
stale backup must not take an instance out of a load balancer or fail a deploy.
`scripts/deploy.sh` prints the state on every deploy instead.

A failure also *arrives*: `OnFailure=` runs `scripts/alert.sh`, which writes
`$DATA_DIR/.backup-last-failure` and mails the operator through the app's own
transport. Rehearse it without breaking anything:

```bash
sudo systemctl start fernscout-alert@fernscout-backup.service
journalctl -u fernscout-alert@fernscout-backup.service -n 20
```

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

Every step below was executed on the native stack on 2026-09-01. Where the
earlier draft was wrong, the correction is inline and marked — the four things
that had to change are the whole value of having run it.

```bash
# 0. Fresh machine: steps 1–5 of "First deploy", with the same
#    RESTIC_REPOSITORY / RESTIC_PASSWORD.

# 1. Load the environment FIRST. Without this, step 1 fails with
#    "Please specify repository location" and step 3 silently tries to read
#    /db/postgres.dump, because $DATABASE_URL is empty. sudo does not carry
#    the service's environment; nothing else supplies it.
set -a; . /etc/fernscout/env; set +a

# 2. Restore the latest snapshot to a scratch directory. -E keeps the restic
#    credentials across sudo.
sudo -E restic restore latest --target /restore

# 3. The tree keeps its original absolute path — find it once.
STAGED=$(sudo find /restore -maxdepth 4 -type d -name 'fernscout-backup-staging' | head -1)

# 4. restic restores as root, and pg_restore below runs as fernscout.
#    Without this it fails with "Permission denied" on the dump.
sudo chmod -R a+rX /restore

# 5. Database (skip if this deployment has none). createdb fails harmlessly
#    if a previous attempt already made it — that is not the restore failing.
sudo -u postgres createdb fernscout -O fernscout || true
sudo -E -u fernscout pg_restore --dbname="$DATABASE_URL" --clean --if-exists \
  "$STAGED/db/postgres.dump"

# 6. DATA_DIR. On this deployment CONTENT_DIR is *inside* DATA_DIR
#    (/var/lib/fernscout/content), so this one rsync restores the journals too.
#    There is no `$STAGED/content/` in a snapshot from this layout: since B444
#    the backup skips the second stage rather than copying the same bytes
#    twice, and says so in its log. On the un-nested layout (CONTENT_DIR is the
#    git checkout, DATA_DIR elsewhere) `$STAGED/content/` is there as before —
#    see the note below for what to do with it.
sudo rsync -a "$STAGED/data/" /var/lib/fernscout/
sudo chown -R fernscout:fernscout /var/lib/fernscout

#    If a snapshot does carry "$STAGED/content/": do NOT rsync it into
#    /srv/fernscout/content/. That is the
#    git checkout, not what the app reads. It left 49 tracked files modified,
#    and scripts/deploy.sh does `git pull --ff-only`, so the next deploy would
#    have refused. Restore there only if CONTENT_DIR is unset — i.e. the app
#    really is reading the checkout.

# 7. Build and start.
cd /srv/fernscout && sudo -u fernscout npm ci && sudo -u fernscout npm run build
sudo systemctl restart fernscout

# 8. Verify: health, then a known reaction count on a known day.
curl -s https://<domain>/api/health
```

### Restore drill — executed and timed

- [x] **Run on the native stack — 2026-09-01, ~35 seconds end to end.**

Seeded: 7 reaction rows on a known day, an uncommitted file under
`content/`, and a 64 KiB `originals/DRILL.RAF` that is in neither git nor the
export. Backed up, then dropped the database and `rm -rf`'d `DATA_DIR`
entirely. **All three came back identical** — the row count exact, both file
hashes matching. `restic restore` moved 453 MiB in 1 second; `npm ci` plus the
build was 29 of the 35 seconds.

An earlier drill against the previous containerised layout took 46 seconds and
is superseded by this one.

Four things the procedure got wrong, all now fixed above: the environment was
never loaded, so it failed at the first command; the restored tree was
unreadable by the user that reads it; `createdb` aborted a re-run; and the
`content/` rsync wrote to a directory this deployment does not read while
dirtying the deploy checkout.

Three more surfaced in *setting the backup up*, which had never been done on
this machine at all (B65):

- `RESTIC_REPOSITORY` must be under a path in the unit's `ReadWritePaths=`
  (`/var/backups/fernscout`). Anywhere else and systemd refuses to start the
  service with `Failed at step NAMESPACE`, before `backup.sh` runs at all.
- The repository must be **owned by the service user**. Root-owned, the
  script's probe fails on permissions — which the old probe read as "not
  initialised yet", so it ran `restic init` and died on `config file already
  exists`. **Fixed in B63:** the probe is `restic cat config` now, and it
  distinguishes *absent* from *cannot see it*; the ownership requirement is
  unchanged, but getting it wrong now produces a message that says so.
- A single unreadable file anywhere under `DATA_DIR` aborted the whole backup:
  `cp -a` failed, `set -e` stopped the script, and nobody was told. One
  root-owned stray file left by an operator was enough. **Both halves are fixed
  now.** B64 added the `OnFailure=` alert, the stamp files and the
  `/api/health` `.backup` block described above, so somebody is told; **B114**
  stopped the file from vetoing the run — staging keeps going, names every path
  it could not take, pushes the snapshot it *could* take, and then still exits
  non-zero so the run is never recorded as a success. See §Backups above.

---

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| Service won't start | `journalctl -u fernscout -n 50`. A capability enabled without its credentials **fails the boot on purpose**, naming the flag and the variable. |
| TLS not issued | `journalctl -u caddy -n 50`. Almost always DNS not resolving to this host yet, or port 80 blocked. |
| Site up, features missing | `curl -s localhost:3000/api/health` — each capability states why it is off. |
| Reactions vanished after adding a database | `npm run db:import` moves the JSON state in. It is idempotent. |
| Deploy failed mid-build | The old process is still serving. Fix, re-run `./scripts/deploy.sh`. |
| An agent reports "failed to fetch" and you cannot tell whether it arrived | Turn on [Request logging](#apihealth) and check `journalctl -u fernscout` for the path (B257). Off by default, so there is nothing to check until it is. |
