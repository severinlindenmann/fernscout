---
id: B203
title: OnFailure sits in the [Service] section, so systemd ignores it and a failed backup still tells nobody
type: ISSUE
priority: high
complexity: low
area: backup, systemd, ops
found: "2026-09-04"
started: "2026-09-04T07:17:29Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T07:17:29Z"
---

# B203 — The alert is wired into the wrong section

## Why

Found immediately after deploying `d564bce`, which finally installed B138's
units on fernscout.ch. The units are on the box, `fernscout-alert@.service`
resolves — and **the alert still cannot fire**, because the directive that
would trigger it is in the wrong section of the unit file.

`deploy/fernscout-backup.service`, as installed at
`/etc/systemd/system/fernscout-backup.service`:

```
2:  [Unit]
7:  [Service]
…
21: OnFailure=fernscout-alert@%n.service
```

`OnFailure=` is a **`[Unit]`** directive. At line 21 it is inside `[Service]`,
where it means nothing. systemd says so, three times, in the journal:

```
Sep 04 07:04:24 systemd[1]: /etc/systemd/system/fernscout-backup.service:21:
  Unknown key 'OnFailure' in section [Service], ignoring.
```

And the loaded state agrees — the file has the line, systemd does not:

```
$ systemctl show fernscout-backup.service -p FragmentPath -p LoadState
LoadState=loaded
FragmentPath=/etc/systemd/system/fernscout-backup.service
$ systemctl show fernscout-backup.service --all | grep -i onfailure
OnFailure=
OnFailureOf=
```

**So B64 is still not fixed on the server, after everything.** The chain took
three tickets to get here and the last link is a section header:

- B64 built the alert and the stamp. The stamp half works — the 03:26 nightly
  run recorded a success and `/api/health` now reports `state: ok`.
- B138 found that deploys never installed units, and fixed it.
- The deploy ran, the units installed, and the alert is still inert.

A backup that fails tonight will leave the unit in `failed` and mail nobody,
which is the exact sentence B64 was written to delete.

Two things worth carrying out of this beyond the one-line fix:

**Nothing checked the loaded state.** Every previous check — including mine —
looked at whether the file existed and whether it contained the line. The file
was right and the behaviour was wrong. `systemctl show` is the authority on
what systemd believes, and it is what the acceptance should have asked for.

**systemd warned and nobody was listening.** The "Unknown key" line has been
emitted on every `daemon-reload` since the unit was written. `install-units.sh`
runs `daemon-reload` and does not read its output, so the one component that
had the answer discarded it.

## Work

- Move `OnFailure=fernscout-alert@%n.service` into the `[Unit]` section of
  `deploy/fernscout-backup.service`, above `[Service]`. Keep the comment
  explaining `%n` with it.
- Check every other unit in `deploy/` for the same mistake — directives in the
  wrong section fail silently by design, so one instance suggests looking at
  the rest.
- Have `install-units.sh` fail, or at least warn loudly, when `daemon-reload`
  emits "Unknown key" or "Ignoring" for a unit it just installed. That turns
  this whole class from silent into noisy, and it is a few lines around a
  command the script already runs.

## Acceptance

- `systemctl show fernscout-backup.service --all | grep OnFailure` reports the
  alert unit, not an empty value, on the deployed server.
- `daemon-reload` emits no "Unknown key" for any unit in `deploy/`.
- A deliberately failed backup run — `systemd-run` a failing copy, or one
  pointed at an unreachable repository — produces the alert. **That is the
  check B64 has never actually had**, and it is the only one that proves the
  wiring rather than the file.
- `install-units.sh` does not report success when systemd rejected a key.
