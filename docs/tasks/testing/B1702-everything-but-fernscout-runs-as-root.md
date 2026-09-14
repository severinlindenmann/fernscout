---
id: B1702
title: Everything but Fernscout runs as root on the VPS, and SSH takes passwords with nothing throttling it
type: OPS
priority: high
complexity: medium
area: vps, ssh, systemd, patching
found: "2026-09-14T07:05:56Z"
merged: "2026-09-14T07:38:51Z"
---

# B1702 — Everything but Fernscout runs as root on the VPS, and SSH takes passwords with nothing throttling it

## Why

Measured on the box on 2026-09-14, read-only. Debian 13, kernel
6.12.63, ufw default-deny inbound with 22, 443 and the mosh range open.

**Fernscout is the only thing on this server that is confined.**
`fernscout.service` and `fernscout-worker.service` run as `fernscout:fernscout`
with `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome` and
`ReadWritePaths` scoped to `/srv/fernscout` and `/var/lib/fernscout`.

Everything else does not:

- `polybot.service` — `User=root`, `ExecStart=/bin/bash -lc
  '/root/poly-bot-v3/restart.sh'`, no hardening directives at all.
- `polybot-feed-proxy-local.service` — `User=root`, same.
- The VS Code Insiders tunnel — `/root/.vscode-server-insiders/…`, as root,
  listening on `127.0.0.1:43757`. A persistent remote-access agent with no
  boundary around it.

So any one of them, compromised or merely buggy, reads `/etc/fernscout/env`
(every secret this instance has) and all of `/var/lib/fernscout/content` (every
journal, including `gps/`). The isolation Fernscout's own unit went to the
trouble of declaring is worth nothing while a sibling process on the same box
runs as root. This is the thing that has to be fixed *before* more workloads
land here, not after.

**SSH takes passwords, and nothing is throttling the attempts.** `sshd -T`
reports `passwordauthentication yes`. Root itself is key-only
(`permitrootlogin without-password`) and root is the only account with a login
shell, so there is no account a password actually opens today — but the port
accepts password attempts, and **`journalctl` counted 18,841 failed
authentications in the last 24 hours**. `fail2ban` is not installed. The day
somebody adds the non-root account below, that unbounded guessing becomes a
real door.

**Nothing is being patched.** `unattended-upgrades` is `not-found`, so the
`apt-daily-upgrade.timer` that fires every day acts on nothing, and
`apt-get -s upgrade` lists **88 pending updates**. No reboot is pending yet.

**All administration is root.** Only `root` has a login shell; two keys in
`/root/.ssh/authorized_keys`; no sudoers entries at all, because there is
nobody to have one.

What is already right, so nobody undoes it: ufw default-deny with a three-line
allow list; Redis bound to `127.0.0.1` with `protected-mode yes`; Postgres on
`127.0.0.1` with `scram-sha-256`; Caddy as `caddy` with HSTS;
`/etc/fernscout/env` at `root:fernscout 0640` (not `600` — the nightly backup
reads it as the group); backups running.

## Work

The owner applies these; this ticket is findings and exact commands, not a
change an agent makes. Order matters — the SSH change last, after the new
account can be logged into.

1. **`unattended-upgrades`**, with the Debian security origin enabled, and the
   88 pending updates cleared in one window. Expect a kernel update and
   therefore a reboot; `fernscout.service` comes back on its own.
2. **A non-root admin account** with a sudo entry and the two keys from
   `/root/.ssh/authorized_keys`. Move the VS Code tunnel to it —
   `/root/.vscode-server-insiders` is the current install and a tunnel running
   as root is the widest thing on the box. Prove the login works before step 4.
3. **A user and a hardening block per workload.** `polybot` and
   `polybot-feed-proxy-local` get their own service account, their data moved
   out of `/root`, and the same five directives `fernscout.service` already
   carries: `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=full`,
   `ProtectHome=true`, and a `ReadWritePaths` naming only what they write.
   `ExecStart` should name the binary, not `/bin/bash -lc`.
4. **SSH: `PasswordAuthentication no`**, and `fail2ban` with the `sshd` jail.
   Keys keep working; the 18,841 daily attempts stop being able to succeed at
   all rather than merely failing. Do this from a second, already-open session.
5. **Write the pattern down** in `docs/runbook.md`: a new workload on this box
   gets its own user, its own unit carrying that hardening block, a
   `127.0.0.1` port behind Caddy, and no new ufw rule. That section is the
   deliverable that outlasts this ticket — the next thing added follows it
   instead of being decided again.

Not in scope: containers (a second runtime to patch, and Fernscout would stay
outside it either way); changing the SSH port; touching ufw, Redis, Postgres
or the Caddy configuration, which are all already right.

Port 80 being closed in ufw while Caddy listens on it — so
`http://fernscout.ch` is unreachable and the HTTPS redirect never runs — was
found in the same pass and is a separate ticket, not this one.

## Acceptance

- `systemctl cat polybot polybot-feed-proxy-local` shows a non-root `User=`
  and the same five hardening directives `fernscout.service` carries.
- As that service user: `cat /etc/fernscout/env` and
  `ls /var/lib/fernscout/content` both refused.
- `sshd -T | grep passwordauthentication` says `no`; a password attempt is
  refused; a key login still works; `fail2ban-client status sshd` reports the
  jail active.
- `systemctl is-enabled unattended-upgrades` says enabled, and
  `apt-get -s upgrade | grep -c security` is 0.
- Somebody other than root can log in, use sudo, and reach the VS Code tunnel;
  nothing under `/root` is still serving.
- `docs/runbook.md` has the "adding a workload to this box" section, and it
  matches what the units actually say.

## What was done, 2026-09-14

The owner asked for the work to be carried out rather than handed over, so it
was — all five steps, in the order above.

1. **Patching.** `unattended-upgrades` installed, and
   `/etc/apt/apt.conf.d/20auto-upgrades` written: the package was the missing
   half, but that file is the *other* half, and without it the daily timer
   goes on upgrading nothing. All 88 updates applied; the kernel metapackage
   needed `dist-upgrade` (the `upgrade` run held it back), taking the box from
   6.12.63 to 6.12.107. Rebooted; ssh, Caddy, Postgres, Redis and Fernscout
   all came back, no failed units, severin.io 200, `/api/health` ok.
2. **Admin account.** `severin`, uid 1000, in `sudo`, carrying the two keys
   from `/root/.ssh/authorized_keys`. Created `--disabled-password`, so
   `/etc/sudoers.d/severin` grants `NOPASSWD` — not a privilege increase,
   since the same two keys already open a root session, and a sudo that can
   prompt for a password nobody has is a locked door with no key. `passwd
   severin` plus deleting that file is the stricter version.
   `/root/.vscode-server-insiders` (1.3 GB, running as root until the reboot)
   removed; the tunnel reinstalls itself under whichever account connects, so
   connecting as `severin@` is now what moves it.
3. **The root services.** Both polybot units turned out to be **disabled and
   inactive** — the owner confirmed the project is archived — and what was
   actually running was two `uvicorn` processes started by hand from
   `/root/poly-bot-v3/.venv` outside systemd entirely. The reboot ended them
   and nothing brings them back, which is what the owner wanted. No service
   account was built for an archived project, and the units were left
   *disabled rather than masked*: a masked unit is a trap for whoever
   resurrects this. If it comes back it follows the runbook pattern, which is
   what step 5 is for.
4. **SSH.** `/etc/ssh/sshd_config.d/10-b1702-hardening.conf` —
   `PasswordAuthentication no`, `KbdInteractiveAuthentication no`,
   `PermitEmptyPasswords no`, `MaxAuthTries 3`. `fail2ban` with
   `backend = systemd` in `jail.local`, because **the stock jail reads
   `/var/log/auth.log` and this box has no such file** — sshd logs to the
   journal, so a default install would have run, looked healthy and matched
   nothing. It banned five addresses within seconds of starting. The owner's
   own address is in `ignoreip`. Verified after the reload: key logins work
   as both `root` and `severin`, a forced password attempt is refused.
   `PermitRootLogin` left at `without-password` — root by key still works,
   which is the way back if the sudo path ever breaks.
5. **The pattern** is `docs/runbook.md` § "Sharing the box with other
   workloads", merged on `b1702-runbook-workloads`.

Left for a person: connect as `severin@` once so the editor server installs
there, and decide whether `PermitRootLogin no` is wanted now that the
unprivileged path is proven. Port 80 being closed in ufw while Caddy listens
on it is still unfiled.
