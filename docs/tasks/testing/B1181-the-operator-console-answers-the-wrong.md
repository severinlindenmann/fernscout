---
id: B1181
title: The operator console answers the wrong question first: no single attention list, no net, no unit cost, and the roster is split across three panels
type: FEATURE
priority: medium
complexity: high
area: app/admin, lib/adminConsole.ts
found: "2026-09-09T20:31:06Z"
started: "2026-09-09T20:31:46Z"
merged: "2026-09-09T21:03:21Z"
---

# B1181 — The operator console answers the wrong question first: no single attention list, no net, no unit cost, and the roster is split across three panels

## Why

B996 gave `/admin` the right skeleton — a queue above three tabs — and the
tabs are still the right three. What is wrong is which question each one
answers first.

**Five different things want a person and there is one list for one of them.**
`Awaiting` (app/admin/page.tsx) is the purchase queue and nothing else. A
health fault and a stale off-site copy are a badge on the third tab; a journal
at 96% of its quota is a meter in the `Storage` panel that nobody scrolls to;
a journal that cannot afford its next send is on no list at all. Four of the
five are things the operator learns about from somebody complaining.

**The headline leaves the subtraction to the reader.** `Tiles` prints Out and
In as two tiles side by side (app/admin/page.tsx:349). The number the page
exists for is the difference, and nothing on the page states it.

**There is no unit cost.** A total says what last month cost. Whether the next
thirty journals are affordable is metered spend per active journal, per day
written, per conversation — three divisions of numbers `dashboard()` already
returns, and none of them are on the page.

**The roster is one question asked in three places on two tabs.** `Journals`
(rows sorted by spend), `Growth` (signups, never-wrote-a-day) and `Helper`
(pressed/proposed per owner) each hold a third of "who is here and are they
getting anywhere". The drop-off between arriving and still writing — the only
figure that says whether the software works — is arithmetic the operator does
in their head across two tabs.

**A journal row is about spend, and most journals spend nothing.** The
sparkline on a row is thirty days of metered spend, so most rows are a flat
line beside a zero. Whether somebody is still writing is the fact that makes
every other column mean something, and the row does not carry it.

Not in scope, because it is already right: `SpendChart` is metered-only and
says why (app/admin/SpendChart.tsx). It is missing only the sentence naming
the fixed floor beside it, which its own doc comment says the page states and
the page does not.

## Work

1. `lib/adminConsole.ts` — `journalActivity()`: one `readdir` + `stat` walk per
   trip, sibling to `daysByWeek`, returning per journal `{ days, lastDay,
   lastWroteAt }`. `lastDay` is the day described (the filename); `lastWroteAt`
   is the file's own mtime, which is the only available answer to "is this
   person still writing" and says so — a restore from backup resets it.
2. `lib/adminConsole.ts` — `attention()`: a pure function over what the page
   already fetched (awaiting payments, `Health`, `Trouble[]`, the status
   journals, the quota ceiling, balances) returning one ranked list of things
   that want a person. Purchases, faults, stale backups, journals near the
   quota ceiling, journals below one send's credit.
3. `lib/adminConsole.ts` — `signupDates()` (min `created_at` per owner), reused
   by `signupsByWeek`, and `funnel()`: signed up → wrote a day → published one
   → wrote in the last 14 days, over 90 days, with the drop-off between each.
4. `app/admin/page.tsx` — `NeedsYou` replaces `Awaiting`, above the tabs,
   rendering the whole `attention()` list. Empty says so and carries the quiet
   facts (commit, uptime, last backup).
5. Money tab — `Verdict` (net, with both halves and their deltas) replaces
   `Tiles`; `Units` adds the four unit figures; the fixed floor is stated
   beside `SpendChart`.
6. People tab — the Journals tab becomes People: `Funnel`, a helper summary at
   instance scale (pressed/proposed with a trend, guard fires), and the journal
   rows gaining last-wrote and disk. `Growth`'s signup bars move here; the
   `Storage` panel folds into the rows, keeping its one instance-wide line.
   Per-owner helper rows move into the journal's own panel.
7. Instance tab — health, backups and activity unchanged; what is left of
   `Growth` becomes a roster summary.

Not doing: any new source of truth, counter or cache. Every figure is a
division of something the page already fetches, or one walk of a directory it
already walks. Nothing here grants credits — the band shows the queue and
cannot approve it.

## Acceptance

- `test/admin-console.test.ts` covers `attention()`: every kind appears, an
  instance with nothing wrong returns an empty list, and a fault that is in
  `health.wrong` appears once rather than twice.
- `funnel()` is tested for the ordinary case and for an instance with no
  database, where it reports what it could not count rather than zeroes.
- `npm run verify` green.
- On the running instance, `/admin` shows a net figure, a unit-cost row, the
  funnel, and a journal table whose first column is when somebody last wrote.
