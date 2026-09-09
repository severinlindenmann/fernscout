---
id: B883
title: recordPrint has no callers, so npm run verify is red on main
type: ISSUE
priority: medium
complexity: low
area: photobook
found: "2026-09-07T18:00:21Z"
superseded: "af81a7d8 (\"Photobook: claim, spend, print, refund what was refused\"), which landed the Gelato print flow and gave recordPrint its caller. Stale before this session even started."
---

# B883 — recordPrint has no callers, so npm run verify is red on main

## Why

`npm run verify` failed its fifth step on `main` as found: `recordPrint`
(`lib/photobook/orders.ts:356:23`) was exported and called by nothing. It had
arrived in `cf4cac61` ("Photobook: print state on the order that was built",
2026-09-07 19:38) beside `claimForPrint`, which was called — read at the time
as one half of the Gelato submission path landing before the other, per this
ticket's own Work section: *"The caller is still coming"*.

It was. `af81a7d8` ("Photobook: claim, spend, print, refund what was refused",
2026-09-07 20:26 — 48 minutes after `cf4cac61`, and before this ticket's
`found:` timestamp) added `lib/photobook/print.ts`, which imports and calls
`recordPrint` at line 190. By the time this session started work
(2026-09-08T21:27), the fix had already been on `main` for over a day.

## Work

None — validated stale, no code changed.

**Evidence gathered:**

```
$ git grep -n recordPrint -- lib app scripts test
lib/photobook/print.ts:13:  recordPrint,
lib/photobook/print.ts:190:  await recordPrint(owner, id, payload, result.providerRef);
lib/photobook/orders.ts:386:export async function recordPrint(
```

`recordPrint` has a real caller now, in the file the Gelato submission flow
lives in. `knip.jsonc` has no entry for it — it was never suppressed, it was
wired up.

```
$ npm run unused
...
Configuration hints (6)
... (6 knip.jsonc housekeeping hints, no unused-export findings)
$ echo $?
0
```

`npm run unused` exits 0 on this branch (cut from current `main`).

**The deeper question — is the recurring mechanism now prevented, or only
kept being cleaned up after the fact?**

B880, B881, B883 and B896 are four recordings of the same shape: a branch
exports a symbol its own new caller uses, another branch's merge removes or
never lands that caller, and `main` goes red on `npm run unused` with no
test failing. Reading all four in sequence:

- B880 and B881 are the two earliest, independent captures of the same
  `recordPrint` finding (cf4cac61's export, before af81a7d8's caller landed).
  Both were superseded by the Gelato session landing the caller.
- B883 (this ticket) is a third capture of the identical finding, opened
  18 minutes before the fix commit — already stale at open time, confirmed
  stale now.
- B896, opened later the same day for a *different* symbol
  (`defaultSizeFor`), diagnosed the mechanism explicitly (merges, not
  branches, introduce it) and updated `.claude/skills/work-on-a-task/SKILL.md`
  to tell whoever merges: *"If you run only one thing, run `npm run
  unused`"* after merging into `main`, citing B880/B881/B883/B896 by name.
  It explicitly declined a git hook — *"hooks here are gitignored
  per-machine configuration... a hook would fix this checkout and no
  other"* — so the fix is a documentation update, not an enforcement
  mechanism.

So: **the mechanism is not mechanically prevented, only caught faster and
with a named playbook.** `verify`'s own knip step (B24) already prevents a
*branch* from introducing this into its own commits; nothing prevents a
*merge* from doing so, because the check that would catch it (`npm run
unused` run again, on `main`, after the merge) is advisory prose in a skill
file, not a hook or a CI gate that runs on merge. Since B896's skill edit
landed (merged 2026-09-08T05:03:08Z), no new occurrence has been observed
in this checkout — `npm run unused` is clean on `main` right now — but that
is one day of evidence for a reminder that depends on the merging agent
choosing to read and follow it. This is a known, explicitly-decided
limitation (B896 considered and rejected a hook), not a fresh gap worth a
new capture.

## Acceptance

- `npm run verify` passes all five steps on a clean `main` — confirmed via
  `npm run unused` (the step this ticket was about) exiting 0 on this branch,
  cut from current `main`. Full `npm run verify` was not re-run since no code
  changed and the other four steps are unrelated to this finding.
- Frontmatter records `superseded: af81a7d8`.
