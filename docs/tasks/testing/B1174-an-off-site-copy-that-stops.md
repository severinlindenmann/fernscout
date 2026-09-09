---
id: B1174
title: An off-site copy that stops arriving says nothing wrong on /admin
type: ISSUE
priority: high
complexity: low
area: admin, backup, DR
found: "2026-09-09T20:10:14Z"
started: "2026-09-09T20:10:35Z"
merged: "2026-09-09T20:23:11Z"
---

# B1174 — An off-site copy that stops arriving says nothing wrong on /admin

## Why

`/admin` does carry backup information — `BackupPanel` in
`app/admin/page.tsx:851` — and for the **primary** it is good: a state pill
that carries the colour, the last success, the age, the staleness threshold,
and the last failure in coral. The off-site copy gets one line of
`text-xs text-navy-500`, the faintest type on the card:

```
Off-site copy: {state} · {lastSuccessAt}
```

No colour, no age, no threshold. `stale` and `ok` render identically.

Worse, nothing alarms. `wrongNow()` in `lib/adminConsole.ts:480` reads
`backup.state` and never `backup.secondary.state`, so an off-site copy that
worked for months and then stopped leaves the card above saying **"Nothing is
wrong."** in green.

That is the exact failure B1075 was written about. The off-site copy sat
unconfigured on the live instance from B659 shipping until 2026-09-09, and
what found it was somebody reading raw JSON out of `/api/health` — not the
page built for exactly this. Since B1159 the off-site copy is also the one
with the seven-day floor: the primary keeps thirty nights, so a fortnight of
unnoticed off-site failure loses more than the same fortnight on the primary
would.

## Work

- `lib/adminConsole.ts`: a `wrong` entry when `backup.secondary.state` is
  `stale`. Named as what it is — the copy was arriving and has stopped.
- **Not** on `unknown`. That value means "unset by choice" and "set and never
  succeeded" and the health route cannot tell them apart — it says so. An
  alarm that fires permanently on every instance that legitimately chose one
  destination is an alarm nobody reads, which is the same lesson B651 taught
  about nightly mail.
- `app/admin/page.tsx`: give the off-site line the primary's treatment — its
  own state pill carrying the colour, the age, the staleness threshold, and
  its `reason` when there is one. It is a sibling fact, not a footnote.

Not doing: anything to `/api/health`, which already reports all of this
correctly; the fault is entirely in what reads it. Not adding a second alarm
route or a mail — B1085 removed the success mail deliberately and the failure
mail already fires on the primary.

## Acceptance

`test/admin-console.test.ts` asserts a stale secondary produces a `wrong`
entry and an `unknown` one produces none. On the page, an off-site state of
`stale` is visually distinguishable from `ok` without reading the timestamp,
at 390px.

## Outcome (2026-09-09)

Both halves done, merged and deployed.

`lib/adminConsole.ts` — the backup rules came out of `health()` into an
exported `backupWrongs(backup)`. That was not tidying: `health()` reaches the
database, the config and three directories, which is why the rules that matter
most here had no test at all. Five now cover it, including the two that
express the judgement — a stale secondary alarms while the primary is fine,
and an `unknown` secondary does not alarm at all.

`app/admin/page.tsx` — the off-site copy is a sibling block with its own state
pill, age, threshold and `reason`, sharing one `stateTone()` with the primary
so the two cannot drift apart.

### Seen, not just tested

Driven in a browser at 390px against the demo journal, all three states, with
the stamps under `.data` moved by hand:

- **stale (74h)** — coral `stale` pill beside the primary's green `ok`, the
  alarm in the red card above, and a `1` badge on the Instance tab. The detail
  says why no mail arrived, which is the part that stops the alarm reading as
  noise.
- **ok (2h)** — green pill, card back to "Nothing is wrong."
- **unknown (no stamp)** — navy pill, no alarm, and the panel prints the
  health route's own reason: unset by choice, or set and never succeeded.

The panel is on the `instance` tab, which is a hash — `/admin#instance`.
Panels are rendered and hidden rather than mounted on tap, so `innerText` on
`/admin` alone shows none of this; that cost a screenshot before it was
noticed and is worth knowing for the next check of this page.

Zero console errors, zero failed requests, at 390px.
