---
id: B110
title: Costs are on at fernscout.ch and no trip's figures have been checked against what the live site converts them to
type: OPS
priority: low
complexity: low
area: costs, currency, ops, capabilities
found: "2026-09-03"
related: B102, B103, B104, B105, B106, B107, B108, B109
merged: "2026-09-11T18:01:25Z"
---

# B110 — Costs are on at fernscout.ch and no trip's figures have been checked against what the live site converts them to

## Why

`/api/health` reports `costs` enabled, with no environment variable and no
database: it reads `content/rates/ecb.json` through `lib/currency.ts`,
`lib/costs.ts` and `lib/costFormat.ts`.

Two things about that are only true on the server. `scripts/deploy.sh` syncs
`content/rates` into `CONTENT_DIR` — which is a step that exists because B56
was exactly this bug for `content/locales`, and fernscout.ch served August's
German for as long as it was up. And `npm run rates:update` has to be run by
somebody or something, or the reference rates never move at all; nothing on the
deployed instance is known to run it.

A costs page converting at last spring's rate looks precisely like one that
works. That is the whole reason this needs a person with the source file open
next to the live page.

B17 (how a trip gets its rates) and B19 (a planned trip's costs page) are on
this path.

## Related

One campaign, not nine tasks: every capability this instance can switch on,
driven once against fernscout.ch by somebody who can read the answer. They
share the standing rules, the test journal and the rule that every defect
becomes its own capture. The order is forced — B102 first (everything else
arrives by mail), then B103, and the rest in any order. B101 is the same
shape pointed at the gate rather than the feature.

## Work

- Open a costs page on fernscout.ch for a trip that has one, and check the
  figures by hand against that trip's `costs.md` and against today's real rate.
- Read `content/rates/ecb.json` **on the server**: how old is it, and is the
  file the app reads the one under `CONTENT_DIR` or the one `git pull` wrote?
  Those are different files and B56 is the precedent for them diverging.
- Find out what updates it on a schedule. If the answer is nothing, say so
  plainly — that is a finding, and it is the most likely one here.
- Check a trip whose currency is not the journal's `baseCurrency`.
- Check a planned trip's costs page (B19).
- Check a trip whose rate is missing entirely: does the page say so, or does it
  just print a number?

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- Live figures checked against the source `costs.md` by hand, with both
  recorded.
- The age and the path of the rates file the running app actually reads.
- A plain answer on whether anything updates the rates on a schedule, and a
  backlog task for it if nothing does.
- B17 and B19 confirmed or contradicted.
- One backlog task per defect, referencing B110.


## Engagement run, 2026-09-11
Run 2026-09-11 against fernscout.ch. **No defect. The figures reconcile exactly.**

## The check

`example/asia-2023`, a five-month trip with costs in CHF, THB, VND and EUR.

| | |
| --- | --- |
| Summed from disk, using the trip's own rates | **CHF 2,478** |
| Rendered on `/example/trips/asia-2023/costs` | **CHF 2,478** |

Every cost line priced; nothing unconverted, nothing dropped.

## What it took three attempts to see, which is the useful part

My first sum came to **2,355** and I was about to report a 123 CHF discrepancy
plus four unconvertible lines. Both would have been wrong, for the same reason:
I converted with tonight's ECB table.

**A trip carries its own `rates:` block**, and `asia-2023` does —
`THB: 0.0258, VND: 0.0000372, EUR: 0.98`. That is the correct design rather
than a workaround: a 2023 trip converts at 2023 rates. Pricing a five-month
2023 trip at tonight's fixing would tell its owner something false about what it
cost them. `lib/config.ts:611-616` says the same from the other side — trip
rates "must degrade rather than fail", unlike the instance's own file, which is
validated strictly because it is "the one file a cloner edits".

So the conversion chain is: **the trip's own rates → the instance's manual
rates → the ECB table.** Neither the journal's `config.json` nor the instance
config carries `manualRates` here (both `null`), so this trip is resolved
entirely by its own block.

## Two things confirmed in passing

- **The ECB table is fresh and in the right place.** `/var/lib/fernscout/rates/ecb.json`,
  `base: EUR`, `date: 2026-09-11`, 29 rates, written at 18:32 — which also means
  B1288's nightly refresh off the backup timer is firing. B1084 moved this out
  of the checkout and there is no stale copy in either old location.
- `/example/trips/parks-2025/costs` reconciles too, in USD at 1.1592.

## The gap this found, which B110 did not ask about

**The ECB table has no VND.** `rates["VND"]` is absent — the ECB simply does not
publish it. A trip with a VND cost and **no** `rates:` block of its own has
nothing to convert with.

`asia-2023` is fine because its author wrote the rates down. A person adding a
Vietnam cost to a trip that has no block would hit `lib/currency.ts:106` —
`rate === undefined ? undefined : …` — and what the page then shows is untested
here. Worth its own ticket; not filed, because whether that is a real hole
depends on what the costs page does with an `undefined`, and checking that needs
a trip built for it.


Full record: `.claude/runs/2026-09-11-open-queue/B110/findings.md`
