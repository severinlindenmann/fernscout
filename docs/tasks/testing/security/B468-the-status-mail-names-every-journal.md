---
id: B468
title: The status mail names every journal, including unlisted ones, to an address a journal's own config chooses
type: SECURITY
priority: high
complexity: low
area: backups
found: "2026-09-05T13:20:01Z"
started: "2026-09-05T13:20:22Z"
merged: "2026-09-05T13:24:33Z"
---

# B468 — The status mail names every journal, including unlisted ones, to an address a journal's own config chooses

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B464 put an instance-wide report into the nightly success mail: every journal
by name, its trips, days, drafts, guests, credit balance and bytes. Who that
mail goes to is decided by `recipient()` in `scripts/alert.mts`:

```ts
const configured = process.env.BACKUP_ALERT_EMAIL?.trim();
if (configured) return { to: configured, username };
const owner = username ? getUser(username)?.owner : undefined;   // <-- the default journal's owner
```

**`BACKUP_ALERT_EMAIL` is not set on fernscout.ch.** Verified 2026-09-05:
`grep -c "^BACKUP_ALERT_EMAIL=" /etc/fernscout/env` is 0. So the recipient is
whatever address sits in `content/example/config.json` — a *journal's* file,
not the operator's configuration. Today that is the operator's own address and
nothing has leaked. It is one edit to somebody's `owner.email` from not being.

What the mail now carries that it did not before:

- **The names of unlisted journals.** Six of the ten on this instance are
  unlisted, which `listedUsernames()` exists to honour — a `guest` journal is
  not advertised on `/documentation.txt`, the landing page or the sitemap, and
  this mail advertises all of them in one list.
- **Guest counts and credit balances** per journal, which are nobody's business
  but that journal owner's.

The failure mail has always carried a `journalctl` tail, and those lines do
contain `/var/lib/fernscout/content/<username>/…` paths — so this is an
existing seam widened rather than a new one. Widened is enough: a path in a
stack trace is a leak nobody designed, and a formatted roster of every journal
on the box is a leak somebody did.

## Work

The instance-wide report goes only to an address **the operator configured**.
`BACKUP_ALERT_EMAIL` is that address; a journal's `owner.email` is not, and the
fallback exists so that a box with no configuration can still shout about a
broken backup — which is a different thing from being handed an inventory.

So: when `BACKUP_ALERT_EMAIL` is unset, the success mail carries its summary
line and a sentence saying the report needs an operator address, naming the
variable. The failure path keeps the fallback exactly as it is — an unreachable
backup must still reach somebody, and B64 is what that silence costs.

Then set `BACKUP_ALERT_EMAIL` in `/etc/fernscout/env` on the VPS, and say so in
`docs/runbook.md` and `.env.example` where the variable is described.

Not doing: per-journal status mails, or a redacted report. An operator asked
for the state of the instance; the answer is to be sure it is an operator
asking.

## Acceptance

`npm run status | npm run alert -- --outcome success --dry-run` with no
`BACKUP_ALERT_EMAIL` sends no journal names, and says which variable to set.
With it set, the full report goes. A failure mail is unchanged either way, and
still reaches the fallback address.

## What was built

`recipient()` now says *how* it found the address — `isOperator` is true only
when `BACKUP_ALERT_EMAIL` supplied it — and the success body is withheld when
it is false, replaced by three lines naming the variable to set.

**Withheld, not redacted.** A summary of a report nobody may read is still a
report, and deciding which of ten journal names is safe to keep is a judgement
this script has no basis for.

The failure path is untouched and tested to stay that way: it still reaches the
fallback address, in full, with the journal tail it has always carried. An
unreachable backup has to reach somebody, which is B64, and B468 must not be
the reason a broken backup goes quiet.

Documented where the variable is described rather than only in the code:
`.env.example` and `docs/runbook.md` both now say it is not optional on an
instance hosting journals other than your own, and why.

## Evidence

- `test/alert-script.test.ts` — a success to the fallback carries no journal
  name and names the variable; the same success to `BACKUP_ALERT_EMAIL` carries
  the roster; a failure to the fallback is unchanged and withholds nothing.
- One existing B458 test now passes an operator address, since it asserts the
  success *wording* and would otherwise be reading a withheld body.
- `npm run verify` — all four, green.

## Still to do on the host

`BACKUP_ALERT_EMAIL` is unset in `/etc/fernscout/env` on fernscout.ch, which is
what made this reachable. Set it to the operator's address, or tonight's
success mail correctly carries no report.
