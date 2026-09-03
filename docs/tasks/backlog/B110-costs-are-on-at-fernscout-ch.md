---
id: B110
title: Costs are on at fernscout.ch and no trip's figures have been checked against what the live site converts them to
type: CHORE
priority: low
complexity: low
area: costs, currency, ops, capabilities
found: "2026-09-03"
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
