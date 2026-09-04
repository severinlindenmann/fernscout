---
id: B203
title: OnFailure sits in the [Service] section, so systemd ignores it and a failed backup still tells nobody
type: ISSUE
priority: high
complexity: low
area: backup, systemd, ops
found: "2026-09-04"
started: "2026-09-04T07:17:29Z"
merged: "2026-09-04T07:49:24Z"
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

## What was built

The one-line fix, and then the thing that would have caught it.

- `deploy/fernscout-backup.service` — `OnFailure=fernscout-alert@%n.service`
  moved into `[Unit]`, with the comment and a note about where it used to sit.
- **Every other unit was checked and is clean.** Four files, no other
  misplaced directive.
- `test/systemd-units.test.ts` — new. It parses `deploy/*.service` and
  `deploy/*.timer` the way systemd does (a directive belongs to whatever
  section header last appeared above it) and checks each key against a
  directive → section table. The table is an **allow-list**: a key not in it
  fails the test rather than passing unexamined, which makes adding one the
  moment somebody looks the section up. It runs on every machine, including
  macOS, which is where these files are edited and where there is no systemd
  to ask.
  It also runs `systemd-analyze verify` where that exists — Linux CI, the
  VPS — and fails on the `Unknown key` / `Unknown lvalue` / `Unknown section`
  class only. Failing on everything `verify` says would mean failing on every
  machine that is not the VPS: it complains about a missing `fernscout` user
  and an absent `/srv/fernscout` on any runner.
- `scripts/install-units.sh` — after `daemon-reload`, runs
  `systemd-analyze verify` over the units it just installed and **exits 1** if
  systemd rejected a key. `SYSTEMD_ANALYZE` overrides the binary so the test
  suite can drive both outcomes. A machine with no verifier is not a failure,
  but the deploy log says the check did not happen.
- `test/install-units.test.ts` — four new cases (rejected key fails the
  install; a clean verify says so; a verify that only complains about a
  half-built machine is tolerated; no verifier is announced), and the existing
  `OnFailure` assertion now checks the section rather than only the line.

## Correction to the Work section

> Have `install-units.sh` fail […] when `daemon-reload` emits "Unknown key" or
> "Ignoring" for a unit it just installed.

**`daemon-reload` emits nothing of the sort to its caller.** The parse warnings
come from PID 1 and go to the journal; `systemctl daemon-reload` exits silently
whatever it just refused to understand, so capturing its output would have
produced a check that could never fire — the same shape of defect as the one
being fixed. `systemd-analyze verify` is what actually surfaces them, and it
reads the installed copies, so it also catches a unit edited by hand in
`/etc/systemd/system`. That is what was built instead.

## Evidence

Both new checks were run against the **pre-fix** file (`git show HEAD:` of the
unit, restored afterwards) and fail on it, naming the line the journal named:

```
× fernscout-backup.service puts every directive in a section systemd reads it in
    fernscout-backup.service:21 — OnFailure= sits in [Service], and systemd only
    reads it in [Unit]. It parses, it loads, and the directive does nothing (B203).
× the backup unit can tell somebody it failed
× installs the alert template a backup unit's OnFailure= depends on
```

With the fix: `npx vitest run test/systemd-units.test.ts test/install-units.test.ts`
→ 21 passed, 1 skipped (the `systemd-analyze` case, on macOS).

## What still needs the operator and the VPS

Three of the four acceptance lines are the deployed server's and cannot be
reached from here — there is no systemd on the machine this was built on:

- `systemctl show fernscout-backup.service --all | grep OnFailure` reporting
  the alert unit. **Only true after the next deploy**, which is what installs
  the corrected file.
- `daemon-reload` emitting no `Unknown key` for any unit in `deploy/`.
- A deliberately failed run producing the alert — still the check B64 has
  never had. `systemctl start fernscout-alert@fernscout-backup.service`
  rehearses the handler; pointing `RESTIC_REPOSITORY` at an unreachable
  address for one run rehearses the wiring.

The fourth — `install-units.sh` does not report success when systemd rejected
a key — is built and tested here, and will additionally be visible on the
server the first time it runs there.
