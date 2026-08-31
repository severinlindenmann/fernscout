# W16 — Deployment, backups, health

**Roadmap:** B1, B6, B8, B9, M1, §2.2 · **Depends on:** W02 · **Wave B**

## Goal
A fresh VPS becomes a TLS site with packages, a systemd unit and one deploy
script. **Backups you have actually restored from.**

> **Amended (decision 27): no Docker.** The stack installs natively — Node,
> Caddy, and Postgres only if a feature needs it. See §2.3 of the roadmap for
> why, and `docs/runbook.md` for the procedure.

## Scope

### Native stack
`node` (the Next.js server, under systemd) + `caddy` + **optionally** Postgres
and a worker. The prototype tier installs neither — there is no Postgres on the
box at all (ROADMAP §2.2), which is simply a package you did not install rather
than a profile you did not enable.

Units live in `deploy/`: `fernscout.service`, `fernscout-worker.service`,
`fernscout-backup.{service,timer}`.

### Caddy, not nginx+certbot
Automatic ACME, auto-renewal, no cron, 4-line config. Needs :80 for the
challenge and :443. Removes a whole class of expiry incidents.

### M1 — backups, the highest-value item in the project
- Nightly: `pg_dump` (or the SQLite file) + `$DATA_DIR` + `content/` →
  restic/rclone to **off-VPS** storage
- **A documented, executed restore drill.** A backup that has never been
  restored is not a backup. Write down how long it took.

### Health + visibility (B8, B9)
`/api/health` reporting capability resolution (which features are on, which are
disabled and why), an uptime ping, and self-hosted Umami/Plausible so you can
see whether family actually read it without shipping Google to grandparents.

### CI (B6)
GitHub Actions: lint, typecheck, test **on both SQLite and Postgres**, build.
Deploy by image pull on the VPS.

## Acceptance
- [ ] Fresh machine → documented package installs + `systemctl enable --now fernscout` → working HTTPS site
- [ ] Prototype runs with **Postgres not installed at all**
- [ ] `/api/health` shows each capability's state and reason
- [ ] **Restore drill completed and timed**, written up in `docs/runbook.md`
- [ ] CI matrix green on both dialects
